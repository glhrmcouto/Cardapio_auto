-- ========================================================================
-- AOOBA! BAR — agrupar a mesma pessoa por NOME, não por cliente_id
-- (migração 013)
-- Pré-requisito: 012_realtime_sessoes.sql.
--
-- Problema visto em produção: cliente_id é gerado uma vez por navegador/aba
-- e guardado em sessionStorage (ver script.js). Em celular, isso pode se
-- perder NO MEIO da mesma visita física à mesa — o navegador recarrega a
-- página em segundo plano (falta de memória, o app trocou de tela e voltou,
-- etc.) e sessionStorage reseta, gerando um cliente_id NOVO pra mesma
-- pessoa física, mesmo ela digitando o mesmo nome de novo. Resultado: a
-- mesma pessoa aparecia duas vezes na "Conta da mesa" (ex.: dois
-- "Guilherme" separados), e "Fechar minha parte" só fechava METADE do que
-- ela realmente devia — a outra metade ficava presa embaixo do cliente_id
-- antigo, exigindo dois fechamentos pra uma pessoa só.
--
-- A partir daqui, cliente_id continua existindo (é o que aciona a ação —
-- "fechar_parcial" ainda recebe um cliente_id, pra saber QUEM clicou), mas
-- a IDENTIDADE de negócio (quem deve o quê, quem já fechou, quem ainda tá
-- em aberto) passa a ser o NOME normalizado (trim + minúsculas) dentro da
-- sessão da mesa — todo cliente_id que já usou aquele nome nessa sessão é
-- tratado como a mesma pessoa.
-- ========================================================================

-- ========================================================================
-- FUNÇÃO PRIVADA: _nome_norm_do_cliente
-- ========================================================================
-- Nome normalizado (trim + minúsculas) do cliente_id, a partir do pedido
-- mais recente dele nessa sessão. Retorna null se esse cliente_id não tiver
-- nenhum pedido na sessão (ex.: abriu o modal de conta sem nunca ter pedido).

create or replace function public._nome_norm_do_cliente(p_sessao_id uuid, p_cliente_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select lower(trim(coalesce(cliente_nome, '')))
  from pedidos
  where sessao_id = p_sessao_id and tipo = 'pedido' and cliente_id = p_cliente_id
  order by criado_em desc
  limit 1;
$$;

revoke all on function public._nome_norm_do_cliente(uuid, uuid) from public;

-- ========================================================================
-- RPC: criar_pedido (substitui a versão de 008_sessoes.sql) — elegibilidade
-- do rateio compartilhado passa a ser por NOME, não por cliente_id
-- ========================================================================
-- Sem isso, se "Guilherme" perdesse o cliente_id no meio da visita, o banco
-- contaria ele DUAS vezes na divisão de um narguilé novo (uma vez por cada
-- cliente_id), inflando o N do rateio por engano.

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
      -- Elegibilidade por NOME normalizado (não por cliente_id): junta os
      -- cliente_id que já usaram o mesmo nome nessa sessão antes de decidir
      -- quem "ainda está na mesa" — grava o cliente_id mais recente daquele
      -- nome na linha do rateio (só pra manter a coluna preenchida; quem
      -- realmente importa daqui em diante é o nome).
      with candidatos as (
        select
          lower(trim(coalesce(p1.cliente_nome, ''))) as nome_norm,
          p1.cliente_id,
          p1.criado_em
        from pedidos p1
        where p1.sessao_id = v_sessao_id
          and p1.tipo = 'pedido'
          and p1.criado_em <= v_pedido.criado_em
      ),
      por_nome as (
        select
          nome_norm,
          max(criado_em) as ultimo_pedido,
          (array_agg(cliente_id order by criado_em desc))[1] as cliente_id_recente
        from candidatos
        group by nome_norm
      ),
      elegivel as (
        select pn.nome_norm, pn.cliente_id_recente as cliente_id
        from por_nome pn
        where pn.ultimo_pedido > coalesce(
          (select max(pg.criado_em)
           from pagamentos pg
           where pg.sessao_id = v_sessao_id
             and pg.criado_em <= v_pedido.criado_em
             and lower(trim(pg.nome)) = pn.nome_norm),
          '-infinity'::timestamptz
        )
      )
      insert into rateio_compartilhado (pedido_item_id, cliente_id, valor)
      select
        v_pedido_item_id,
        elegivel.cliente_id,
        round((v_produto.preco * v_quantidade) / count(*) over (), 2)
      from elegivel;
    end if;
  end loop;

  return v_pedido;
end;
$$;

comment on function public.criar_pedido(int, text, jsonb, text, uuid) is 'Único caminho de escrita de pedidos pro cliente (anon). Vincula o pedido à sessão aberta e, pra itens compartilhados, congela a fatia de cada NOME elegível (não cliente_id — junta cliente_id diferentes que usaram o mesmo nome) em rateio_compartilhado.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 009_fechamento_parcial.sql,
-- os privilégios já concedidos lá continuam valendo.

-- ========================================================================
-- RPC: fechar_parcial (substitui a versão de 011_correcoes_saldo_e_concorrencia.sql)
-- ========================================================================
-- Passa a fechar TODOS os itens/rateios ainda em aberto de quem usou o
-- MESMO NOME nessa sessão — não só os vinculados ao cliente_id que chamou a
-- função. É isso que corrige "Fechar minha parte" fechando só metade da
-- conta de alguém cujo cliente_id mudou no meio da visita.

create or replace function public.fechar_parcial(
  p_mesa         int,
  p_token        text,
  p_cliente_id   uuid,
  p_aceita_taxa  boolean default true
)
returns pagamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa          mesas;
  v_sessao_id     uuid;
  v_nome          text;
  v_nome_norm     text;
  v_valor_direto  numeric(10, 2);
  v_valor_rateio  numeric(10, 2);
  v_subtotal      numeric(10, 2);
  v_taxa          numeric(10, 2);
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

  v_nome_norm := lower(trim(v_nome));

  -- Trava por mesa+NOME (não mais só cliente_id): junta automaticamente
  -- pedidos feitos com cliente_id diferentes desde que o nome bata, e evita
  -- duas chamadas em paralelo (clique duplo, ou duas "metades" da mesma
  -- pessoa fechando ao mesmo tempo) duplicarem o pagamento.
  perform pg_advisory_xact_lock(hashtext('fechar_parcial:' || p_mesa::text), hashtext(v_nome_norm));

  select coalesce(sum(pi.preco_unitario * pi.quantidade), 0) into v_valor_direto
  from pedido_itens pi
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and p.tipo = 'pedido'
    and lower(trim(coalesce(p.cliente_nome, ''))) = v_nome_norm
    and pi.compartilhado = false and pi.pagamento_id is null;

  select coalesce(sum(rc.valor), 0) into v_valor_rateio
  from rateio_compartilhado rc
  join pedido_itens pi on pi.id = rc.pedido_item_id
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and rc.pagamento_id is null
    and exists (
      select 1 from pedidos p2
      where p2.cliente_id = rc.cliente_id and p2.sessao_id = v_sessao_id and p2.tipo = 'pedido'
        and lower(trim(coalesce(p2.cliente_nome, ''))) = v_nome_norm
    );

  v_subtotal := round(v_valor_direto + v_valor_rateio, 2);

  if v_subtotal <= 0 then
    raise exception 'Você não tem nada em aberto nessa mesa.';
  end if;

  v_taxa := case when p_aceita_taxa then round(v_subtotal * public._taxa_servico_percentual() / 100, 2) else 0 end;

  insert into pagamentos (sessao_id, cliente_id, nome, subtotal, taxa_servico, valor_total, status, taxa_aceita)
  values (v_sessao_id, p_cliente_id, v_nome, v_subtotal, v_taxa, v_subtotal + v_taxa, 'pendente', p_aceita_taxa)
  returning * into v_pagamento;

  update pedido_itens pi
  set pagamento_id = v_pagamento.id
  from pedidos p
  where pi.pedido_id = p.id
    and p.sessao_id = v_sessao_id and p.tipo = 'pedido'
    and lower(trim(coalesce(p.cliente_nome, ''))) = v_nome_norm
    and pi.compartilhado = false and pi.pagamento_id is null;

  update rateio_compartilhado rc
  set pagamento_id = v_pagamento.id
  where rc.pagamento_id is null
    and exists (
      select 1
      from pedido_itens pi
      join pedidos p on p.id = pi.pedido_id
      where pi.id = rc.pedido_item_id and p.sessao_id = v_sessao_id
    )
    and exists (
      select 1 from pedidos p2
      where p2.cliente_id = rc.cliente_id and p2.sessao_id = v_sessao_id and p2.tipo = 'pedido'
        and lower(trim(coalesce(p2.cliente_nome, ''))) = v_nome_norm
    );

  return v_pagamento;
end;
$$;

comment on function public.fechar_parcial(int, text, uuid, boolean) is 'Fecha a parte de uma pessoa (identificada pelo NOME normalizado, agregando todo cliente_id que já usou esse nome na sessão): congela subtotal, taxa e total num pagamento pendente e vincula os itens/rateios a ele.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 010_taxa_servico_configuravel.sql,
-- os privilégios já concedidos lá continuam valendo.

-- ========================================================================
-- FUNÇÃO PRIVADA: _conta_da_mesa_dados (substitui a versão de 010) — resumo
-- por pessoa agrupado por NOME normalizado, não por cliente_id
-- ========================================================================

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
      coalesce(sum(valor_total) filter (where status = 'confirmado'), 0)::numeric(10, 2) as total_pago,
      coalesce(sum(valor_total) filter (where status = 'pendente'), 0)::numeric(10, 2) as total_pendente
    from pagamentos
    where sessao_id = p_sessao_id
  ),
  pessoas as (
    select distinct on (nome_norm) nome_norm, nome_exibicao
    from (
      select
        lower(trim(coalesce(cliente_nome, ''))) as nome_norm,
        coalesce(nullif(trim(cliente_nome), ''), 'Sem nome') as nome_exibicao,
        criado_em
      from pedidos
      where sessao_id = p_sessao_id and tipo = 'pedido'
    ) x
    order by nome_norm, criado_em desc
  ),
  aberto_direto as (
    select
      lower(trim(coalesce(p.cliente_nome, ''))) as nome_norm,
      coalesce(sum(pi.preco_unitario * pi.quantidade), 0) as valor
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
      and pi.compartilhado = false and pi.pagamento_id is null
    group by 1
  ),
  cliente_nomes as (
    select distinct on (cliente_id) cliente_id, lower(trim(coalesce(cliente_nome, ''))) as nome_norm
    from pedidos
    where sessao_id = p_sessao_id and tipo = 'pedido'
    order by cliente_id, criado_em desc
  ),
  aberto_rateio as (
    select cn.nome_norm, coalesce(sum(rc.valor), 0) as valor
    from rateio_compartilhado rc
    join pedido_itens pi on pi.id = rc.pedido_item_id
    join pedidos p on p.id = pi.pedido_id
    join cliente_nomes cn on cn.cliente_id = rc.cliente_id
    where p.sessao_id = p_sessao_id and rc.pagamento_id is null
    group by cn.nome_norm
  ),
  pagos_por_pessoa as (
    select
      lower(trim(nome)) as nome_norm,
      coalesce(sum(subtotal) filter (where status = 'confirmado'), 0) as subtotal_pago,
      coalesce(sum(taxa_servico) filter (where status = 'confirmado'), 0) as taxa_pago,
      coalesce(sum(subtotal) filter (where status = 'pendente'), 0) as subtotal_aguardando,
      coalesce(sum(taxa_servico) filter (where status = 'pendente'), 0) as taxa_aguardando
    from pagamentos
    where sessao_id = p_sessao_id
    group by 1
  ),
  por_pessoa_calc as (
    select
      pe.nome_exibicao as nome,
      coalesce(ad.valor, 0) + coalesce(ar.valor, 0) as subtotal_aberto,
      round((coalesce(ad.valor, 0) + coalesce(ar.valor, 0)) * public._taxa_servico_percentual() / 100, 2) as taxa_aberto,
      coalesce(pg.subtotal_aguardando, 0)::numeric(10, 2) as subtotal_aguardando,
      coalesce(pg.taxa_aguardando, 0)::numeric(10, 2) as taxa_aguardando,
      coalesce(pg.subtotal_pago, 0)::numeric(10, 2) as subtotal_pago,
      coalesce(pg.taxa_pago, 0)::numeric(10, 2) as taxa_pago
    from pessoas pe
    left join aberto_direto ad on ad.nome_norm = pe.nome_norm
    left join aberto_rateio ar on ar.nome_norm = pe.nome_norm
    left join pagos_por_pessoa pg on pg.nome_norm = pe.nome_norm
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
    'taxa_servico', round((select subtotal from subtotal_calc) * public._taxa_servico_percentual() / 100, 2),
    'total_geral', (select subtotal from subtotal_calc) + round((select subtotal from subtotal_calc) * public._taxa_servico_percentual() / 100, 2),
    'taxa_servico_percentual', public._taxa_servico_percentual(),
    'total_pago', (select total_pago from pagamentos_totais),
    'total_pendente_confirmacao', (select total_pendente from pagamentos_totais),
    'saldo_restante', greatest(
      (select subtotal from subtotal_calc) + round((select subtotal from subtotal_calc) * public._taxa_servico_percentual() / 100, 2)
        - (select total_pago from pagamentos_totais) - (select total_pendente from pagamentos_totais),
      0
    ),
    'por_pessoa', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'nome', nome,
           'status', case
             when subtotal_aberto > 0 then 'em_aberto'
             when (subtotal_aguardando + taxa_aguardando) > 0 then 'aguardando'
             else 'pago'
           end,
           'subtotal', case
             when subtotal_aberto > 0 then subtotal_aberto
             when (subtotal_aguardando + taxa_aguardando) > 0 then subtotal_aguardando
             else subtotal_pago
           end,
           'taxa_servico', case
             when subtotal_aberto > 0 then taxa_aberto
             when (subtotal_aguardando + taxa_aguardando) > 0 then taxa_aguardando
             else taxa_pago
           end,
           'valor', case
             when subtotal_aberto > 0 then subtotal_aberto + taxa_aberto
             when (subtotal_aguardando + taxa_aguardando) > 0 then subtotal_aguardando + taxa_aguardando
             else subtotal_pago + taxa_pago
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
-- FUNÇÃO PRIVADA: _minha_parte_dados (substitui a versão de 010) — escopo
-- por NOME normalizado, não por cliente_id exato
-- ========================================================================
-- "Minha parte" agora mostra os itens de TODO cliente_id que já usou o
-- mesmo nome nessa sessão, não só os do cliente_id salvo no navegador atual.

create or replace function public._minha_parte_dados(p_sessao_id uuid, p_cliente_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with meu_nome as (
    select public._nome_norm_do_cliente(p_sessao_id, p_cliente_id) as nome_norm
  ),
  itens_diretos as (
    select pi.nome_snapshot, pi.preco_unitario, pi.quantidade, (pi.pagamento_id is not null) as pago
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
      and lower(trim(coalesce(p.cliente_nome, ''))) = (select nome_norm from meu_nome)
      and pi.compartilhado = false
  ),
  itens_compartilhados as (
    select pi.nome_snapshot, rc.valor, (rc.pagamento_id is not null) as pago
    from rateio_compartilhado rc
    join pedido_itens pi on pi.id = rc.pedido_item_id
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
      and exists (
        select 1 from pedidos p2
        where p2.cliente_id = rc.cliente_id and p2.sessao_id = p_sessao_id and p2.tipo = 'pedido'
          and lower(trim(coalesce(p2.cliente_nome, ''))) = (select nome_norm from meu_nome)
      )
  ),
  subtotal_aberto_calc as (
    select
      coalesce((select sum(preco_unitario * quantidade) from itens_diretos where not pago), 0)
      + coalesce((select sum(valor) from itens_compartilhados where not pago), 0) as subtotal
  ),
  pagamentos_pessoa as (
    select
      coalesce(sum(subtotal) filter (where status = 'confirmado'), 0)::numeric(10, 2) as subtotal_pago,
      coalesce(sum(taxa_servico) filter (where status = 'confirmado'), 0)::numeric(10, 2) as taxa_pago,
      coalesce(sum(subtotal) filter (where status = 'pendente'), 0)::numeric(10, 2) as subtotal_aguardando,
      coalesce(sum(taxa_servico) filter (where status = 'pendente'), 0)::numeric(10, 2) as taxa_aguardando
    from pagamentos
    where sessao_id = p_sessao_id
      and lower(trim(nome)) = (select nome_norm from meu_nome)
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
    'subtotal_em_aberto', (select subtotal from subtotal_aberto_calc),
    'subtotal_aguardando', (select subtotal_aguardando from pagamentos_pessoa),
    'taxa_aguardando', (select taxa_aguardando from pagamentos_pessoa),
    'total_aguardando', (select subtotal_aguardando + taxa_aguardando from pagamentos_pessoa),
    'subtotal_pago', (select subtotal_pago from pagamentos_pessoa),
    'taxa_pago', (select taxa_pago from pagamentos_pessoa),
    'total_pago', (select subtotal_pago + taxa_pago from pagamentos_pessoa),
    'status', case
      when (select subtotal from subtotal_aberto_calc) > 0 then 'em_aberto'
      when (select subtotal_aguardando + taxa_aguardando from pagamentos_pessoa) > 0 then 'aguardando'
      else 'pago'
    end
  );
$$;

revoke all on function public._minha_parte_dados(uuid, uuid) from public;

-- conta_da_mesa, conta_da_mesa_balcao e encerrar_sessao não mudam de
-- assinatura nem de corpo nesta migração — já delegam tudo pra
-- _conta_da_mesa_dados/_minha_parte_dados (redefinidas acima), então passam
-- a agrupar por nome automaticamente.
