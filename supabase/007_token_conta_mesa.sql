-- ========================================================================
-- AOOBA! BAR — token da mesa também em conta_da_mesa (migração 007)
-- ========================================================================
-- Gap que ficou aberto em 005_seguranca.sql: criar_pedido e
-- pedir_fechamento já passaram a exigir o token da mesa, mas
-- conta_da_mesa (usada no botão "Fechar Conta" do cliente, pra mostrar o
-- consumo antes de confirmar) continuava aceitando só o número da mesa —
-- qualquer pessoa sabendo o número de uma mesa alheia conseguia consultar
-- quanto ela já gastou. Não dava pra criar pedido falso com isso (é só
-- leitura), mas vazava informação que não é dela. Agora exige o mesmo
-- token das outras duas RPCs, com a mesma mensagem genérica de recusa.
--
-- "drop" é necessário porque adicionar p_token muda a assinatura da
-- função (mesmo motivo de 005_seguranca.sql) — sem isso a versão antiga,
-- sem token, continuaria executável por anon.

drop function if exists public.conta_da_mesa(int);

create or replace function public.conta_da_mesa(p_mesa int, p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_mesa      mesas;
  v_resultado jsonb;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar sua conta. Verifique o QR code da mesa.';
  end if;

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
  into v_resultado
  from totais;

  return v_resultado;
end;
$$;

comment on function public.conta_da_mesa(int, text) is 'Itens, subtotal, taxa de serviço (10%) e total consolidado da mesa (ignora pedidos já finalizados). Exige o token da mesa — sem ele, recusa com mensagem genérica. Usado no modal de fechar conta do cliente.';

grant execute on function public.conta_da_mesa(int, text) to anon;
