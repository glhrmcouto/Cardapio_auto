-- ========================================================================
-- AOOBA! BAR — taxa de serviço no fechamento de conta (migração 006)
-- ========================================================================
-- 10% de taxa de serviço, cobrada só quando a conta INTEIRA da mesa é
-- fechada — nunca nos pedidos individuais. pedidos.total continua sendo
-- só a soma dos itens (sem taxa): é o que os relatórios somam como
-- faturamento de produto, e taxa de serviço não é receita do bar, é
-- repassada à equipe — misturar os dois vazaria a taxa pro faturamento de
-- vendas sem querer.
--
-- Só troca a definição de conta_da_mesa (mesma assinatura de 001_schema.sql,
-- "create or replace" já basta, sem precisar de "drop function"). O cardápio
-- (script.js) e o balcão (balcao.js, que faz a mesma conta localmente,
-- porque não passa pela RPC) passam a mostrar subtotal + taxa + total.
-- ========================================================================

create or replace function public.conta_da_mesa(p_mesa int)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with agrupado as (
    select
      pi.nome_snapshot,
      pi.preco_unitario,
      sum(pi.quantidade)::int as quantidade
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.mesa = p_mesa
      and p.tipo = 'pedido'
      and p.status in ('pendente', 'entregue')
    group by pi.nome_snapshot, pi.preco_unitario
  ),
  totais as (
    select coalesce(sum(preco_unitario * quantidade), 0)::numeric(10, 2) as subtotal
    from agrupado
  )
  select jsonb_build_object(
    'itens', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'preco', preco_unitario, 'quantidade', quantidade)
         order by nome_snapshot
       )
       from agrupado),
      '[]'::jsonb
    ),
    'subtotal', totais.subtotal,
    'taxa_servico', round(totais.subtotal * 0.10, 2),
    'total', totais.subtotal + round(totais.subtotal * 0.10, 2)
  )
  from totais;
$$;

comment on function public.conta_da_mesa(int) is 'Itens, subtotal, taxa de serviço (10%) e total consolidado da mesa (ignora pedidos já finalizados). Usado no modal de fechar conta do cliente.';

grant execute on function public.conta_da_mesa(int) to anon;
