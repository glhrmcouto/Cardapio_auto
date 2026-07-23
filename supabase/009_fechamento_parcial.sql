-- ========================================================================
-- AOOBA! BAR — fechamento parcial por pessoa, com valor congelado por item
-- (migração 009)
-- Pré-requisito: 008_sessoes.sql (sessoes, pedidos.sessao_id/cliente_nome/
-- cliente_id, pedido_itens.compartilhado).
--
-- Esta migração SUBSTITUI o "fechamento individual" simples da 008
-- (fechamentos_individuais / fechar_conta_individual), que recalculava o
-- rateio na hora e não deduzia nada do total da mesa. A partir daqui:
--   - cada item (direto ou a fração de um compartilhado) fica vinculado a
--     um "pagamento" quando alguém fecha a parte dela — esse vínculo é
--     definitivo, os valores não são recalculados depois;
--   - conta_da_mesa mostra o saldo real (total - pago - aguardando
--     confirmação), então o garçom nunca cobra duas vezes o que já foi
--     pago;
--   - fechar a sessão inteira passa a exigir que esse saldo esteja zerado
--     (ou confirmação explícita do garçom, se ele quiser fechar mesmo
--     assim — ver encerrar_sessao).
-- ========================================================================

-- ========================================================================
-- LIMPEZA: remove o fechamento individual antigo (substituído por
-- pagamentos + rateio_compartilhado abaixo). Ainda não há uso real em
-- produção dessa tabela, então dropar é seguro e evita manter dois
-- sistemas paralelos fazendo a mesma coisa.
-- ========================================================================

drop function if exists public.fechar_conta_individual(int, text, uuid);
drop table if exists fechamentos_individuais;

-- ========================================================================
-- TABELA: pagamentos
-- ========================================================================

create table pagamentos (
  id            uuid primary key default gen_random_uuid(),
  sessao_id     uuid not null references sessoes (id),
  cliente_id    uuid not null,
  nome          text not null,
  valor         numeric(10, 2) not null check (valor >= 0),
  status        text not null default 'pendente' check (status in ('pendente', 'confirmado')),
  criado_em     timestamptz not null default now(),
  confirmado_em timestamptz null
);

comment on table pagamentos is 'Um registro por "fechei a minha parte": valor já congelado (subtotal da pessoa + taxa de serviço) no momento da criação. status=pendente até o garçom confirmar que recebeu (ver confirmar_pagamento).';

create index idx_pagamentos_sessao_id on pagamentos (sessao_id);
create index idx_pagamentos_cliente_id on pagamentos (cliente_id);
create index idx_pagamentos_status on pagamentos (status);

alter table pagamentos enable row level security;

-- Só o balcão lê a lista de pagamentos (pra saber quem quer fechar e o saldo
-- da mesa). Sem policy de INSERT/UPDATE/DELETE de propósito: a única forma de
-- gravar é fechar_parcial (cria) e confirmar_pagamento (atualiza), as duas
-- SECURITY DEFINER — nada disso é update direto de tabela, ao contrário do
-- fechamento individual antigo, exatamente pra manter confirmado_em e status
-- sempre consistentes.
create policy "pagamentos_select_authenticated"
  on pagamentos for select
  to authenticated
  using (true);

alter publication supabase_realtime add table pagamentos;

-- ========================================================================
-- ALTER: pedido_itens — vínculo com o pagamento que já cobriu esse item
-- ========================================================================

alter table pedido_itens add column pagamento_id uuid references pagamentos (id);

comment on column pedido_itens.pagamento_id is 'Pagamento que cobriu este item (só pra itens NÃO compartilhados). Nulo = ainda não foi fechado por ninguém.';

create index idx_pedido_itens_pagamento_id on pedido_itens (pagamento_id);

-- ========================================================================
-- TABELA: rateio_compartilhado
-- ========================================================================
-- Uma linha por (item compartilhado, pessoa elegível), com a fatia dela já
-- calculada e congelada no momento em que o item foi lançado (ver o novo
-- trecho de criar_pedido mais abaixo) — é isso que garante que quem chega
-- na mesa DEPOIS de um narguilé compartilhado já lançado nunca é cobrado
-- por ele, e que o valor da fatia de cada um não muda mais depois de
-- calculado, não importa quem feche a conta primeiro.
--
-- "Elegível" pra um item = tinha pedido nessa sessão até o instante em que
-- o item foi lançado E, nesse mesmo instante, o pedido mais recente dela
-- era mais novo que o último pagamento dela (ou ela nunca pagou nada ainda)
-- — ou seja, ela ainda "estava na mesa" quando o item chegou. Isso também
-- resolve sozinho o caso de alguém fechar a conta e depois pedir de novo:
-- a partir do pedido novo, ela volta a ser elegível pros itens compartilhados
-- seguintes.

create table rateio_compartilhado (
  id             bigint generated always as identity primary key,
  pedido_item_id bigint not null references pedido_itens (id),
  cliente_id     uuid not null,
  valor          numeric(10, 2) not null check (valor >= 0),
  pagamento_id   uuid references pagamentos (id)
);

comment on table rateio_compartilhado is 'Fatia de cada pessoa elegível num item compartilhado, congelada no momento em que o item foi pedido (ver criar_pedido). pagamento_id nulo = a fatia dessa pessoa ainda não foi fechada/paga.';

create index idx_rateio_compartilhado_pedido_item_id on rateio_compartilhado (pedido_item_id);
create index idx_rateio_compartilhado_cliente_id on rateio_compartilhado (cliente_id);
create index idx_rateio_compartilhado_pagamento_id on rateio_compartilhado (pagamento_id);

alter table rateio_compartilhado enable row level security;

create policy "rateio_compartilhado_select_authenticated"
  on rateio_compartilhado for select
  to authenticated
  using (true);

-- Sem policy de INSERT/UPDATE pra ninguém de propósito: só criar_pedido
-- (grava as fatias) e fechar_parcial (vincula ao pagamento) escrevem aqui,
-- as duas SECURITY DEFINER.

-- ========================================================================
-- RPC: criar_pedido (substitui a versão de 008_sessoes.sql)
-- ========================================================================
-- Mesma assinatura e mesma validação de antes. A única mudança: ao gravar
-- um item compartilhado, já materializa o rateio_compartilhado dele (uma
-- linha por pessoa elegível, ver comentário da tabela acima) — congelado
-- na hora, nunca recalculado depois.

create or replace function public.criar_pedido(
  p_mesa         int,
  p_token        text,
  p_itens        jsonb,
  p_cliente_nome text,
  p_cliente_id   uuid
)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido            pedidos;
  v_mesa              mesas;
  v_sessao_id         uuid;
  v_pedidos_recentes  int;
  v_total             numeric(10, 2) := 0;
  v_total_itens       int := 0;
  v_item              jsonb;
  v_produto           produtos;
  v_quantidade        int;
  v_compartilhado     boolean;
  v_nome_limpo        text;
  v_pedido_item_id    bigint;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  v_nome_limpo := nullif(trim(coalesce(p_cliente_nome, '')), '');
  if v_nome_limpo is null then
    raise exception 'Informe seu nome antes de fazer o pedido.';
  end if;
  if length(v_nome_limpo) > 20 then
    raise exception 'Nome muito longo (máximo de 20 caracteres).';
  end if;

  if p_cliente_id is null then
    raise exception 'Não foi possível identificar seu pedido. Recarregue a página e tente de novo.';
  end if;

  select count(*) into v_pedidos_recentes
  from pedidos
  where mesa = p_mesa
    and tipo = 'pedido'
    and criado_em > now() - interval '2 minutes';

  if v_pedidos_recentes >= 5 then
    raise exception 'Aguarde um instante antes de fazer outro pedido.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_quantidade := (v_item ->> 'quantidade')::int;

    if v_quantidade is null or v_quantidade < 1 or v_quantidade > 50 then
      raise exception 'Quantidade inválida para um dos itens (deve ser entre 1 e 50).';
    end if;

    v_total_itens := v_total_itens + v_quantidade;

    select * into v_produto
    from produtos
    where id = (v_item ->> 'produto_id')::bigint
      and ativo = true;

    if not found then
      raise exception 'Produto % não encontrado ou indisponível.', (v_item ->> 'produto_id');
    end if;

    v_total := v_total + (v_produto.preco * v_quantidade);
  end loop;

  if v_total_itens > 40 then
    raise exception 'Esse pedido tem itens demais (máximo de 40 por pedido). Divida em mais de um pedido.';
  end if;

  insert into sessoes (mesa) values (p_mesa)
  on conflict (mesa) where status = 'aberta' do nothing;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;

  insert into pedidos (tipo, mesa, total, status, sessao_id, cliente_nome, cliente_id)
  values ('pedido', p_mesa, v_total, 'pendente', v_sessao_id, v_nome_limpo, p_cliente_id)
  returning * into v_pedido;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_quantidade := (v_item ->> 'quantidade')::int;
    v_compartilhado := coalesce((v_item ->> 'compartilhado')::boolean, false);

    select * into v_produto
    from produtos
    where id = (v_item ->> 'produto_id')::bigint;

    insert into pedido_itens (pedido_id, produto_id, nome_snapshot, preco_unitario, quantidade, compartilhado)
    values (v_pedido.id, v_produto.id, v_produto.nome, v_produto.preco, v_quantidade, v_compartilhado)
    returning id into v_pedido_item_id;

    if v_compartilhado then
      -- Materializa a fatia de cada pessoa elegível AGORA, com o valor já
      -- calculado — count(*) over () dá o N (quantas pessoas elegíveis) e
      -- a divisão é feita linha a linha, então nunca precisa recalcular
      -- nem re-abrir essa conta depois (ver comentário da tabela).
      insert into rateio_compartilhado (pedido_item_id, cliente_id, valor)
      select
        v_pedido_item_id,
        elegivel.cliente_id,
        round((v_produto.preco * v_quantidade) / count(*) over (), 2)
      from (
        select p1.cliente_id
        from pedidos p1
        where p1.sessao_id = v_sessao_id
          and p1.tipo = 'pedido'
          and p1.criado_em <= v_pedido.criado_em
        group by p1.cliente_id
        having max(p1.criado_em) > coalesce(
          (select max(pg.criado_em)
           from pagamentos pg
           where pg.sessao_id = v_sessao_id
             and pg.cliente_id = p1.cliente_id
             and pg.criado_em <= v_pedido.criado_em),
          '-infinity'::timestamptz
        )
      ) as elegivel;
    end if;
  end loop;

  return v_pedido;
end;
$$;

comment on function public.criar_pedido(int, text, jsonb, text, uuid) is 'Único caminho de escrita de pedidos pro cliente (anon). Vincula o pedido à sessão aberta e, pra itens compartilhados, já congela a fatia de cada pessoa elegível em rateio_compartilhado.';

grant execute on function public.criar_pedido(int, text, jsonb, text, uuid) to anon;

-- ========================================================================
-- RPC: fechar_parcial
-- ========================================================================
-- "Fechar minha parte": soma os itens diretos + fatias de compartilhados
-- ainda não vinculados a nenhum pagamento dessa pessoa, cria o pagamento
-- (status 'pendente') e vincula tudo a ele — congelado, não muda mais.

create or replace function public.fechar_parcial(p_mesa int, p_token text, p_cliente_id uuid)
returns pagamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa          mesas;
  v_sessao_id     uuid;
  v_nome          text;
  v_valor_direto  numeric(10, 2);
  v_valor_rateio  numeric(10, 2);
  v_valor_total   numeric(10, 2);
  v_pagamento     pagamentos;
begin
  if p_mesa is null or p_mesa <= 0 or p_cliente_id is null then
    raise exception 'Não foi possível processar sua solicitação. Verifique o QR code da mesa.';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível processar sua solicitação. Verifique o QR code da mesa.';
  end if;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta';
  if not found then
    raise exception 'Não há consumo em aberto nessa mesa.';
  end if;

  select coalesce(nullif(trim(cliente_nome), ''), 'Sem nome') into v_nome
  from pedidos
  where sessao_id = v_sessao_id and tipo = 'pedido' and cliente_id = p_cliente_id
  order by criado_em desc
  limit 1;

  if not found then
    raise exception 'Não encontramos pedidos seus nessa mesa.';
  end if;

  select coalesce(sum(pi.preco_unitario * pi.quantidade), 0) into v_valor_direto
  from pedido_itens pi
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and p.tipo = 'pedido' and p.cliente_id = p_cliente_id
    and pi.compartilhado = false and pi.pagamento_id is null;

  select coalesce(sum(rc.valor), 0) into v_valor_rateio
  from rateio_compartilhado rc
  join pedido_itens pi on pi.id = rc.pedido_item_id
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and rc.cliente_id = p_cliente_id and rc.pagamento_id is null;

  v_valor_total := round((v_valor_direto + v_valor_rateio) * 1.10, 2);

  if v_valor_total <= 0 then
    raise exception 'Você não tem nada em aberto nessa mesa.';
  end if;

  insert into pagamentos (sessao_id, cliente_id, nome, valor, status)
  values (v_sessao_id, p_cliente_id, v_nome, v_valor_total, 'pendente')
  returning * into v_pagamento;

  update pedido_itens pi
  set pagamento_id = v_pagamento.id
  from pedidos p
  where pi.pedido_id = p.id
    and p.sessao_id = v_sessao_id and p.tipo = 'pedido' and p.cliente_id = p_cliente_id
    and pi.compartilhado = false and pi.pagamento_id is null;

  update rateio_compartilhado rc
  set pagamento_id = v_pagamento.id
  from pedido_itens pi, pedidos p
  where rc.pedido_item_id = pi.id and pi.pedido_id = p.id
    and p.sessao_id = v_sessao_id and rc.cliente_id = p_cliente_id and rc.pagamento_id is null;

  return v_pagamento;
end;
$$;

comment on function public.fechar_parcial(int, text, uuid) is 'Fecha a parte de uma pessoa: congela o valor (itens dela + fatia dos compartilhados ainda não pagos) num pagamento pendente e vincula os itens/rateios a ele. Pode ser chamada de novo depois de pedidos novos (gera outro pagamento).';

grant execute on function public.fechar_parcial(int, text, uuid) to anon;

-- ========================================================================
-- RPC: confirmar_pagamento
-- ========================================================================
-- O garçom confirma que recebeu o dinheiro daquele pagamento pendente.

create or replace function public.confirmar_pagamento(p_pagamento_id uuid)
returns pagamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagamento pagamentos;
begin
  update pagamentos
  set status = 'confirmado', confirmado_em = now()
  where id = p_pagamento_id and status = 'pendente'
  returning * into v_pagamento;

  if not found then
    raise exception 'Pagamento não encontrado ou já confirmado.';
  end if;

  return v_pagamento;
end;
$$;

comment on function public.confirmar_pagamento(uuid) is 'Marca um pagamento pendente como confirmado (garçom recebeu o dinheiro). Restrito a authenticated.';

revoke all on function public.confirmar_pagamento(uuid) from public;
grant execute on function public.confirmar_pagamento(uuid) to authenticated;

-- ========================================================================
-- RPC: detalhe_pagamento
-- ========================================================================
-- Itens diretos + fatias de compartilhados vinculados a um pagamento
-- específico — usado no balcão pra mostrar o detalhe de "o que essa pessoa
-- está fechando" no card de alerta.

create or replace function public.detalhe_pagamento(p_pagamento_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'itens_diretos', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', pi.nome_snapshot, 'preco', pi.preco_unitario, 'quantidade', pi.quantidade)
         order by pi.nome_snapshot
       )
       from pedido_itens pi
       where pi.pagamento_id = p_pagamento_id),
      '[]'::jsonb
    ),
    'itens_compartilhados', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', pi.nome_snapshot, 'valor', rc.valor)
         order by pi.nome_snapshot
       )
       from rateio_compartilhado rc
       join pedido_itens pi on pi.id = rc.pedido_item_id
       where rc.pagamento_id = p_pagamento_id),
      '[]'::jsonb
    )
  );
$$;

comment on function public.detalhe_pagamento(uuid) is 'Itens diretos e fatias de compartilhados cobertos por um pagamento específico. Uso interno do balcão, pro card de alerta de fechamento parcial.';

revoke all on function public.detalhe_pagamento(uuid) from public;
grant execute on function public.detalhe_pagamento(uuid) to authenticated;

-- ========================================================================
-- FUNÇÃO PRIVADA: _conta_da_mesa_dados
-- ========================================================================
-- Núcleo compartilhado por conta_da_mesa (cliente) e conta_da_mesa_balcao
-- (balcão): itens da sessão, totais (geral/pago/aguardando confirmação/
-- saldo restante) e o resumo por pessoa. Não é concedida pra anon nem
-- authenticated de propósito — só é chamada de dentro de outras funções
-- SECURITY DEFINER, que rodam como o dono das tabelas e por isso conseguem
-- chamá-la mesmo sem grant explícito (mesmo raciocínio de
-- public._exigir_admin() em 004_relatorios.sql). Chamar direto com
-- qualquer p_sessao_id (sem token) vazaria a conta de mesas alheias, por
-- isso o revoke no fim do arquivo.

create or replace function public._conta_da_mesa_dados(p_sessao_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with itens_agg as (
    select pi.nome_snapshot, pi.preco_unitario, sum(pi.quantidade)::int as quantidade
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
    group by pi.nome_snapshot, pi.preco_unitario
  ),
  subtotal_calc as (
    select coalesce(sum(preco_unitario * quantidade), 0)::numeric(10, 2) as subtotal
    from itens_agg
  ),
  pagamentos_totais as (
    select
      coalesce(sum(valor) filter (where status = 'confirmado'), 0)::numeric(10, 2) as total_pago,
      coalesce(sum(valor) filter (where status = 'pendente'), 0)::numeric(10, 2) as total_pendente
    from pagamentos
    where sessao_id = p_sessao_id
  ),
  pessoas as (
    select distinct on (cliente_id) cliente_id, coalesce(nullif(trim(cliente_nome), ''), 'Sem nome') as nome
    from pedidos
    where sessao_id = p_sessao_id and tipo = 'pedido'
    order by cliente_id, criado_em desc
  ),
  aberto_direto as (
    select p.cliente_id, coalesce(sum(pi.preco_unitario * pi.quantidade), 0) as valor
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
      and pi.compartilhado = false and pi.pagamento_id is null
    group by p.cliente_id
  ),
  aberto_rateio as (
    select rc.cliente_id, coalesce(sum(rc.valor), 0) as valor
    from rateio_compartilhado rc
    join pedido_itens pi on pi.id = rc.pedido_item_id
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and rc.pagamento_id is null
    group by rc.cliente_id
  ),
  pagos_por_pessoa as (
    select
      cliente_id,
      coalesce(sum(valor) filter (where status = 'confirmado'), 0) as pago,
      coalesce(sum(valor) filter (where status = 'pendente'), 0) as aguardando
    from pagamentos
    where sessao_id = p_sessao_id
    group by cliente_id
  ),
  por_pessoa_calc as (
    select
      pe.cliente_id,
      pe.nome,
      round((coalesce(ad.valor, 0) + coalesce(ar.valor, 0)) * 1.10, 2) as valor_aberto,
      coalesce(pg.aguardando, 0)::numeric(10, 2) as valor_aguardando,
      coalesce(pg.pago, 0)::numeric(10, 2) as valor_pago
    from pessoas pe
    left join aberto_direto ad on ad.cliente_id = pe.cliente_id
    left join aberto_rateio ar on ar.cliente_id = pe.cliente_id
    left join pagos_por_pessoa pg on pg.cliente_id = pe.cliente_id
  )
  select jsonb_build_object(
    'itens', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'preco', preco_unitario, 'quantidade', quantidade)
         order by nome_snapshot
       )
       from itens_agg),
      '[]'::jsonb
    ),
    'subtotal', (select subtotal from subtotal_calc),
    'taxa_servico', round((select subtotal from subtotal_calc) * 0.10, 2),
    'total_geral', (select subtotal from subtotal_calc) + round((select subtotal from subtotal_calc) * 0.10, 2),
    'total_pago', (select total_pago from pagamentos_totais),
    'total_pendente_confirmacao', (select total_pendente from pagamentos_totais),
    'saldo_restante', greatest(
      (select subtotal from subtotal_calc) + round((select subtotal from subtotal_calc) * 0.10, 2)
        - (select total_pago from pagamentos_totais) - (select total_pendente from pagamentos_totais),
      0
    ),
    'por_pessoa', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'cliente_id', cliente_id,
           'nome', nome,
           'status', case
             when valor_aberto > 0 then 'em_aberto'
             when valor_aguardando > 0 then 'aguardando'
             else 'pago'
           end,
           'valor', case
             when valor_aberto > 0 then valor_aberto
             when valor_aguardando > 0 then valor_aguardando
             else valor_pago
           end
         )
         order by nome
       )
       from por_pessoa_calc),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public._conta_da_mesa_dados(uuid) from public;

-- ========================================================================
-- FUNÇÃO PRIVADA: _minha_parte_dados
-- ========================================================================
-- Detalhe da parte de UMA pessoa: itens dela (diretos + fatias de
-- compartilhados), cada um marcado como pago ou não, e os três valores
-- (em aberto agora / aguardando confirmação / já pago) que o cardápio usa
-- pra montar a seção "Minha parte" do modal de conta.

create or replace function public._minha_parte_dados(p_sessao_id uuid, p_cliente_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with itens_diretos as (
    select pi.nome_snapshot, pi.preco_unitario, pi.quantidade, (pi.pagamento_id is not null) as pago
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido' and p.cliente_id = p_cliente_id
      and pi.compartilhado = false
  ),
  itens_compartilhados as (
    select pi.nome_snapshot, rc.valor, (rc.pagamento_id is not null) as pago
    from rateio_compartilhado rc
    join pedido_itens pi on pi.id = rc.pedido_item_id
    where rc.cliente_id = p_cliente_id
      and pi.pedido_id in (select id from pedidos where sessao_id = p_sessao_id and tipo = 'pedido')
  ),
  aberto as (
    select
      coalesce((select sum(preco_unitario * quantidade) from itens_diretos where not pago), 0)
      + coalesce((select sum(valor) from itens_compartilhados where not pago), 0) as subtotal_aberto
  ),
  pagamentos_pessoa as (
    select
      coalesce(sum(valor) filter (where status = 'confirmado'), 0)::numeric(10, 2) as total_pago,
      coalesce(sum(valor) filter (where status = 'pendente'), 0)::numeric(10, 2) as total_aguardando
    from pagamentos
    where sessao_id = p_sessao_id and cliente_id = p_cliente_id
  )
  select jsonb_build_object(
    'itens_diretos', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'preco', preco_unitario, 'quantidade', quantidade, 'pago', pago)
         order by nome_snapshot
       )
       from itens_diretos),
      '[]'::jsonb
    ),
    'itens_compartilhados', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'valor', valor, 'pago', pago)
         order by nome_snapshot
       )
       from itens_compartilhados),
      '[]'::jsonb
    ),
    'total_em_aberto', round((select subtotal_aberto from aberto) * 1.10, 2),
    'total_aguardando', (select total_aguardando from pagamentos_pessoa),
    'total_pago', (select total_pago from pagamentos_pessoa),
    'status', case
      when (select subtotal_aberto from aberto) > 0 then 'em_aberto'
      when (select total_aguardando from pagamentos_pessoa) > 0 then 'aguardando'
      else 'pago'
    end
  );
$$;

revoke all on function public._minha_parte_dados(uuid, uuid) from public;

-- ========================================================================
-- RPC: conta_da_mesa (substitui a versão de 008_sessoes.sql)
-- ========================================================================
-- Ganha p_cliente_id (opcional): quando informado, o retorno inclui
-- "minha_parte" com o detalhe da pessoa. "drop" necessário porque o número
-- de parâmetros muda (mesmo motivo de 005_seguranca.sql).

drop function if exists public.conta_da_mesa(int, text);

create or replace function public.conta_da_mesa(p_mesa int, p_token text, p_cliente_id uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_mesa      mesas;
  v_sessao_id uuid;
  v_resultado jsonb;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar sua conta. Verifique o QR code da mesa.';
  end if;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta';

  v_resultado := public._conta_da_mesa_dados(v_sessao_id);

  if p_cliente_id is not null then
    v_resultado := v_resultado || jsonb_build_object(
      'minha_parte', public._minha_parte_dados(v_sessao_id, p_cliente_id)
    );
  end if;

  return v_resultado;
end;
$$;

comment on function public.conta_da_mesa(int, text, uuid) is 'Itens, totais (geral/pago/aguardando/saldo) e resumo por pessoa da sessão aberta da mesa. Com p_cliente_id, inclui "minha_parte" (itens da pessoa + total em aberto/aguardando/pago dela). Exige o token da mesa.';

grant execute on function public.conta_da_mesa(int, text, uuid) to anon;

-- ========================================================================
-- RPC: conta_da_mesa_balcao (substitui a versão de 008_sessoes.sql)
-- ========================================================================

create or replace function public.conta_da_mesa_balcao(p_mesa int)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_sessao_id uuid;
begin
  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta';
  return public._conta_da_mesa_dados(v_sessao_id);
end;
$$;

comment on function public.conta_da_mesa_balcao(int) is 'Itens, totais (geral/pago/aguardando/saldo) e resumo por pessoa da sessão aberta da mesa. Uso interno do balcão — sem token, qualquer authenticated pode chamar.';

revoke all on function public.conta_da_mesa_balcao(int) from public;
grant execute on function public.conta_da_mesa_balcao(int) to authenticated;

-- ========================================================================
-- RPC: encerrar_sessao (substitui a versão de 008_sessoes.sql)
-- ========================================================================
-- Ganha p_forcar: por padrão, só fecha se o saldo_restante estiver zerado
-- (com tolerância de 2 centavos — a divisão de item compartilhado entre N
-- pessoas pode deixar um resto de arredondamento que nunca soma
-- perfeitamente zero, ver criar_pedido). Se houver saldo e p_forcar=false,
-- recusa e informa quanto falta e de quem; o balcão mostra isso num
-- confirm() e, se o garçom confirmar mesmo assim, chama de novo com
-- p_forcar=true. "drop" necessário porque o número de parâmetros muda.

drop function if exists public.encerrar_sessao(int);

create or replace function public.encerrar_sessao(p_mesa int, p_forcar boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessao_id uuid;
  v_dados     jsonb;
  v_saldo     numeric(10, 2);
  v_lista     text;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;

  if not found then
    raise exception 'Não há sessão aberta para a mesa %.', p_mesa;
  end if;

  v_dados := public._conta_da_mesa_dados(v_sessao_id);
  v_saldo := (v_dados ->> 'saldo_restante')::numeric(10, 2);

  if v_saldo > 0.02 and not p_forcar then
    select string_agg(
      (pessoa ->> 'nome') || ' (R$ ' || round((pessoa ->> 'valor')::numeric, 2)::text || ')',
      ', '
    )
    into v_lista
    from jsonb_array_elements(v_dados -> 'por_pessoa') as pessoa
    where pessoa ->> 'status' = 'em_aberto';

    raise exception 'Ainda falta receber R$ % dessa mesa%.',
      round(v_saldo, 2)::text,
      case when v_lista is not null then ' — ' || v_lista else '' end;
  end if;

  update pedidos
  set status = 'finalizado'
  where sessao_id = v_sessao_id
    and status in ('pendente', 'entregue');

  update sessoes
  set status = 'fechada', fechada_em = now()
  where id = v_sessao_id;
end;
$$;

comment on function public.encerrar_sessao(int, boolean) is 'Fecha a sessão aberta da mesa. Recusa se sobrar saldo (tolerância de 2 centavos) a menos que p_forcar=true, informando quanto falta e de quem. Restrito a authenticated.';

revoke all on function public.encerrar_sessao(int, boolean) from public;
grant execute on function public.encerrar_sessao(int, boolean) to authenticated;
