-- ========================================================================
-- AOOBA! BAR — relatórios de vendas (migração 004)
-- Funções RPC de leitura usadas por relatorios.html. Pré-requisitos:
-- 001_schema.sql (pedidos/pedido_itens/produtos) e 003_admin.sql
-- (tabela "perfis" + função eh_admin()).
--
-- Padrões usados em TODAS as funções abaixo:
--   - Só enxergam pedidos com tipo = 'pedido' (pedidos de consumo). O tipo
--     'fechar_conta' nunca teve valor próprio, é só um sinalizador pro
--     balcão — incluí-lo no faturamento duplicaria receita.
--   - São SECURITY DEFINER (leem pedidos/pedido_itens ignorando RLS, cuja
--     policy de SELECT hoje libera esse acesso pra "authenticated" em
--     geral — balcão incluso — não só pra admin). Por isso cada função
--     chama public._exigir_admin() logo no início e barra explicitamente
--     quem não tiver papel admin, em vez de confiar só no RLS.
--   - Recebem p_data_inicio/p_data_fim como datas civis (sem hora) e
--     comparam contra pedidos.criado_em (timestamptz) convertendo pro
--     fuso America/Sao_Paulo — assim "hoje" e o agrupamento "por hora"
--     batem com o relógio de parede do bar, não com UTC.
-- ========================================================================

-- ========================================================================
-- FUNÇÃO AUXILIAR (privada): _exigir_admin()
-- ========================================================================
-- Não é concedida pra "authenticated" de propósito — só é chamada de
-- dentro das outras funções SECURITY DEFINER deste arquivo (que já rodam
-- como dono das tabelas), nunca diretamente pelo cliente.

create or replace function public._exigir_admin()
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.eh_admin() then
    raise exception 'Acesso restrito a administradores.' using errcode = '42501';
  end if;
end;
$$;

comment on function public._exigir_admin() is 'Barra a execução com exceção se o usuário logado não tiver papel admin. Usada só internamente pelas funções de relatório.';

-- ========================================================================
-- RPC: faturamento_por_dia
-- ========================================================================
-- Soma de pedidos.total por dia civil (fuso America/Sao_Paulo), pro
-- gráfico de linha do período selecionado.

create or replace function public.faturamento_por_dia(p_data_inicio date, p_data_fim date)
returns table (dia date, faturamento numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  perform public._exigir_admin();

  return query
  select
    (p.criado_em at time zone 'America/Sao_Paulo')::date as dia,
    coalesce(sum(p.total), 0)::numeric(10, 2) as faturamento
  from pedidos p
  where p.tipo = 'pedido'
    and p.criado_em >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
    and p.criado_em < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
  group by dia
  order by dia;
end;
$$;

comment on function public.faturamento_por_dia(date, date) is 'Faturamento (soma de pedidos.total) por dia civil no período, só pedidos tipo=pedido. Restrito a admin.';

-- ========================================================================
-- RPC: produtos_mais_vendidos
-- ========================================================================
-- Agrupa por nome_snapshot (não por produto_id) pra continuar contando
-- certo mesmo que o produto tenha sido renomeado ou excluído depois.

create or replace function public.produtos_mais_vendidos(p_data_inicio date, p_data_fim date, p_limite int default 10)
returns table (nome text, quantidade bigint, receita numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  perform public._exigir_admin();

  return query
  select
    pi.nome_snapshot as nome,
    sum(pi.quantidade)::bigint as quantidade,
    sum(pi.quantidade * pi.preco_unitario)::numeric(10, 2) as receita
  from pedido_itens pi
  join pedidos p on p.id = pi.pedido_id
  where p.tipo = 'pedido'
    and p.criado_em >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
    and p.criado_em < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
  group by pi.nome_snapshot
  order by quantidade desc
  limit greatest(coalesce(p_limite, 10), 1);
end;
$$;

comment on function public.produtos_mais_vendidos(date, date, int) is 'Produtos mais vendidos no período (quantidade e receita), ordenado por quantidade desc. Restrito a admin.';

-- ========================================================================
-- RPC: ticket_medio_por_mesa
-- ========================================================================

create or replace function public.ticket_medio_por_mesa(p_data_inicio date, p_data_fim date)
returns table (mesa int, pedidos bigint, ticket_medio numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  perform public._exigir_admin();

  return query
  select
    p.mesa,
    count(*)::bigint as pedidos,
    round(avg(p.total), 2) as ticket_medio
  from pedidos p
  where p.tipo = 'pedido'
    and p.criado_em >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
    and p.criado_em < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
  group by p.mesa
  order by p.mesa;
end;
$$;

comment on function public.ticket_medio_por_mesa(date, date) is 'Número de pedidos e ticket médio (valor médio de pedidos.total) por mesa no período. Restrito a admin.';

-- ========================================================================
-- RPC: vendas_por_categoria
-- ========================================================================
-- Junta com "produtos" pra saber a categoria de cada item — seguro contra
-- itens órfãos porque a FK pedido_itens.produto_id impede excluir um
-- produto que já foi pedido (ver 001_schema.sql).

create or replace function public.vendas_por_categoria(p_data_inicio date, p_data_fim date)
returns table (categoria text, quantidade bigint, receita numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  perform public._exigir_admin();

  return query
  select
    pr.categoria,
    sum(pi.quantidade)::bigint as quantidade,
    sum(pi.quantidade * pi.preco_unitario)::numeric(10, 2) as receita
  from pedido_itens pi
  join pedidos p on p.id = pi.pedido_id
  join produtos pr on pr.id = pi.produto_id
  where p.tipo = 'pedido'
    and p.criado_em >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
    and p.criado_em < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
  group by pr.categoria
  order by receita desc;
end;
$$;

comment on function public.vendas_por_categoria(date, date) is 'Quantidade e receita por categoria de produto no período. Restrito a admin.';

-- ========================================================================
-- RPC: movimento_por_hora
-- ========================================================================
-- generate_series garante as 24 horas no retorno (com zero) mesmo em
-- horários sem nenhum pedido, pro gráfico não ficar com buracos e o
-- horário de pico ficar visualmente claro.

create or replace function public.movimento_por_hora(p_data_inicio date, p_data_fim date)
returns table (hora int, pedidos bigint, receita numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  perform public._exigir_admin();

  return query
  select
    h.hora,
    coalesce(count(p.id), 0)::bigint as pedidos,
    coalesce(sum(p.total), 0)::numeric(10, 2) as receita
  from generate_series(0, 23) as h(hora)
  left join pedidos p
    on extract(hour from (p.criado_em at time zone 'America/Sao_Paulo'))::int = h.hora
    and p.tipo = 'pedido'
    and p.criado_em >= (p_data_inicio::timestamp at time zone 'America/Sao_Paulo')
    and p.criado_em < ((p_data_fim + 1)::timestamp at time zone 'America/Sao_Paulo')
  group by h.hora
  order by h.hora;
end;
$$;

comment on function public.movimento_por_hora(date, date) is 'Número de pedidos e receita por hora do dia (0-23, fuso America/Sao_Paulo), somado no período inteiro — mostra o horário de pico. Restrito a admin.';

-- ========================================================================
-- PERMISSÕES
-- ========================================================================
-- Por padrão o Postgres concede EXECUTE em toda função nova pra PUBLIC
-- (inclusive anon). Revogamos isso e liberamos só pra authenticated — a
-- checagem de papel admin em cada função (_exigir_admin) ainda barra
-- authenticated sem papel admin (ex.: usuário do balcão).

revoke all on function public.faturamento_por_dia(date, date) from public;
revoke all on function public.produtos_mais_vendidos(date, date, int) from public;
revoke all on function public.ticket_medio_por_mesa(date, date) from public;
revoke all on function public.vendas_por_categoria(date, date) from public;
revoke all on function public.movimento_por_hora(date, date) from public;

grant execute on function public.faturamento_por_dia(date, date) to authenticated;
grant execute on function public.produtos_mais_vendidos(date, date, int) to authenticated;
grant execute on function public.ticket_medio_por_mesa(date, date) to authenticated;
grant execute on function public.vendas_por_categoria(date, date) to authenticated;
grant execute on function public.movimento_por_hora(date, date) to authenticated;
