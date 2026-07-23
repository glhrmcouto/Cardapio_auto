-- ========================================================================
-- AOOBA! BAR — taxa de serviço configurável, discriminada nos dois fluxos
-- de fechamento (migração 010)
-- Pré-requisito: 009_fechamento_parcial.sql (pagamentos, rateio_compartilhado,
-- fechar_parcial, conta_da_mesa/conta_da_mesa_balcao/encerrar_sessao).
--
-- Até aqui, os 10% de taxa de serviço estavam fixos no código (0.10 espalhado
-- em várias funções). A partir daqui:
--   - o percentual mora em "configuracoes" (editável pelo admin.html, sem
--     precisar de deploy) e as funções leem de lá através de
--     _taxa_servico_percentual();
--   - cada pagamento (fechar_parcial) congela subtotal/taxa/total em colunas
--     separadas, e pode zerar a taxa se a pessoa recusar (p_aceita_taxa);
--   - conta_da_mesa e conta_da_mesa_balcao sempre discriminam subtotal, taxa
--     e total — tanto no geral da sessão quanto por pessoa.
--
-- Arredondamento: total_geral da sessão é calculado UMA vez sobre o subtotal
-- inteiro (round(subtotal_sessão * pct, 2)) e saldo_restante é sempre
-- "total_geral menos o que já foi cobrado" — nunca uma soma independente de
-- pedaços arredondados. Isso garante, por construção (é só uma subtração),
-- que total_pago + total_pendente_confirmacao + saldo_restante bate exatamente
-- com total_geral, sem sobra nem falta de centavos — o fechamento final (seja
-- o último fechar_parcial, seja o "Conta Fechada" da mesa) sempre absorve
-- qualquer resto de arredondamento das taxas individuais já congeladas.
-- ========================================================================

-- ========================================================================
-- TABELA: configuracoes
-- ========================================================================

create table configuracoes (
  chave text primary key,
  valor text not null
);

comment on table configuracoes is 'Configurações do bar editáveis pelo admin (admin.html) sem precisar de deploy. Uma linha por chave — hoje só "taxa_servico_percentual".';

insert into configuracoes (chave, valor) values ('taxa_servico_percentual', '10');

alter table configuracoes enable row level security;

-- Só admin lê/edita — mesmo padrão de produtos_select_admin em 003_admin.sql.
-- As RPCs de pedido/fechamento continuam enxergando o valor porque são
-- SECURITY DEFINER (rodam como dono da tabela, ignoram RLS).
create policy "configuracoes_select_admin"
  on configuracoes for select
  to authenticated
  using (public.eh_admin());

create policy "configuracoes_update_admin"
  on configuracoes for update
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- Sem policy de INSERT/DELETE de propósito: as chaves existentes são fixas
-- (criadas por migração); o admin só edita o "valor" das que já existem.

create or replace function public._taxa_servico_percentual()
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce((select valor::numeric from configuracoes where chave = 'taxa_servico_percentual'), 0);
$$;

comment on function public._taxa_servico_percentual() is 'Percentual atual da taxa de serviço (0 = desativada). Editável em configuracoes pelo admin.html. Uso interno das RPCs de pedido/fechamento — não precisa de grant explícito, mesmo raciocínio de _exigir_admin() em 004_relatorios.sql.';

-- ========================================================================
-- ALTER: pagamentos — subtotal/taxa/total discriminados e aceite da taxa
-- ========================================================================
-- "valor" vira "valor_total" (mais claro ao lado de subtotal/taxa_servico).
-- Backfill dos pagamentos que já existiam antes desta migração: reconstrói
-- subtotal/taxa a partir do valor_total assumindo os 10% fixos de antes (era
-- a única taxa que existia até aqui).

alter table pagamentos rename column valor to valor_total;

alter table pagamentos add column subtotal numeric(10, 2);
alter table pagamentos add column taxa_servico numeric(10, 2);
alter table pagamentos add column taxa_aceita boolean not null default true;

update pagamentos
set subtotal = round(valor_total / 1.10, 2),
    taxa_servico = valor_total - round(valor_total / 1.10, 2)
where subtotal is null;

alter table pagamentos alter column subtotal set not null;
alter table pagamentos alter column taxa_servico set not null;
alter table pagamentos add constraint pagamentos_subtotal_check check (subtotal >= 0);
alter table pagamentos add constraint pagamentos_taxa_servico_check check (taxa_servico >= 0);

comment on column pagamentos.subtotal is 'Soma dos itens (diretos + fatias de compartilhados) dessa pessoa, sem taxa.';
comment on column pagamentos.taxa_servico is 'Taxa de serviço já congelada (0 se a pessoa recusou — ver taxa_aceita).';
comment on column pagamentos.valor_total is 'subtotal + taxa_servico — o que de fato é cobrado dessa pessoa.';
comment on column pagamentos.taxa_aceita is 'false quando a pessoa desmarcou "incluir taxa de serviço" ao fechar a parte dela.';

-- ========================================================================
-- RPC: fechar_parcial (substitui a versão de 009_fechamento_parcial.sql)
-- ========================================================================
-- Ganha p_aceita_taxa: aplica a taxa (percentual de configuracoes) sobre o
-- SUBTOTAL DELA (proporcional, não o valor cheio da mesa) e congela os três
-- valores no pagamento. Se p_aceita_taxa=false, taxa_servico fica 0.

drop function if exists public.fechar_parcial(int, text, uuid);

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

comment on function public.fechar_parcial(int, text, uuid, boolean) is 'Fecha a parte de uma pessoa: congela subtotal, taxa de serviço (0 se recusada) e o total num pagamento pendente, e vincula os itens/rateios a ele.';

grant execute on function public.fechar_parcial(int, text, uuid, boolean) to anon;

-- ========================================================================
-- FUNÇÃO PRIVADA: _conta_da_mesa_dados (substitui a versão de 009)
-- ========================================================================
-- Mesmo papel de antes, agora usando o percentual configurável e sempre
-- discriminando subtotal/taxa/total — tanto no geral da sessão quanto por
-- pessoa (subtotal/taxa/valor calculados conforme o status dela: em_aberto
-- usa o percentual atual como estimativa; aguardando/pago usam os valores
-- já congelados no pagamento correspondente).

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
      coalesce(sum(subtotal) filter (where status = 'confirmado'), 0) as subtotal_pago,
      coalesce(sum(taxa_servico) filter (where status = 'confirmado'), 0) as taxa_pago,
      coalesce(sum(subtotal) filter (where status = 'pendente'), 0) as subtotal_aguardando,
      coalesce(sum(taxa_servico) filter (where status = 'pendente'), 0) as taxa_aguardando
    from pagamentos
    where sessao_id = p_sessao_id
    group by cliente_id
  ),
  por_pessoa_calc as (
    select
      pe.cliente_id,
      pe.nome,
      coalesce(ad.valor, 0) + coalesce(ar.valor, 0) as subtotal_aberto,
      round((coalesce(ad.valor, 0) + coalesce(ar.valor, 0)) * public._taxa_servico_percentual() / 100, 2) as taxa_aberto,
      coalesce(pg.subtotal_aguardando, 0)::numeric(10, 2) as subtotal_aguardando,
      coalesce(pg.taxa_aguardando, 0)::numeric(10, 2) as taxa_aguardando,
      coalesce(pg.subtotal_pago, 0)::numeric(10, 2) as subtotal_pago,
      coalesce(pg.taxa_pago, 0)::numeric(10, 2) as taxa_pago
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
           'cliente_id', cliente_id,
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
-- FUNÇÃO PRIVADA: _minha_parte_dados (substitui a versão de 009)
-- ========================================================================
-- Agora discrimina subtotal/taxa em aberto, aguardando e pago, pra "Minha
-- parte" no cardápio poder mostrar sempre as três linhas (Subtotal/Serviço/
-- Total) — o valor aberto vem pré-taxa (subtotal_em_aberto): o navegador
-- aplica o percentual (recebido em conta_da_mesa.taxa_servico_percentual) na
-- hora, reagindo ao checkbox "incluir taxa" sem precisar de outra chamada.

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

-- conta_da_mesa, conta_da_mesa_balcao e encerrar_sessao NÃO mudam de
-- assinatura nesta migração — "create or replace" não é necessário porque
-- o corpo delas já delega tudo pra _conta_da_mesa_dados/_minha_parte_dados
-- (redefinidas acima), então já passam a discriminar subtotal/taxa/total e a
-- respeitar o percentual configurável automaticamente.
