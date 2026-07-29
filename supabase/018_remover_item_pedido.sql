-- ========================================================================
-- AOOBA! BAR — remover item de um pedido pendente (migração 018)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
--
-- Caso de uso: cliente pediu errado e o garçom precisa tirar um item ANTES
-- de ir pro preparo — só cobre pedidos ainda 'pendente' (nem entregue, nem
-- finalizado). Itens já entregues ou de mesa já fechada não são alterados
-- por aqui de propósito: mexer neles impactaria total já cobrado/rateado
-- entre pessoas (ver conta_da_mesa_balcao em 009_fechamento_parcial.sql),
-- o que é um problema separado e mais delicado.
--
-- Mesmo padrão de segurança do resto do projeto: nenhuma policy de DELETE
-- em pedido_itens (nem pra authenticated) — a única forma de remover um
-- item é por esta RPC SECURITY DEFINER, que valida o status antes de mexer
-- e recalcula pedidos.total a partir do que sobrou (nunca confia num total
-- vindo do navegador). A confirmação de senha (reautenticar com
-- signInWithPassword) é feita no cliente (js/balcao.js) antes de chamar
-- esta RPC — aqui a única exigência é estar autenticado (qualquer conta do
-- balcão), igual às outras ações da tela.
-- ========================================================================

create or replace function public.remover_item_pedido(p_pedido_id uuid, p_item_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido      pedidos;
  v_novo_total  numeric(10, 2);
begin
  select * into v_pedido from pedidos where id = p_pedido_id;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_pedido.tipo <> 'pedido' or v_pedido.status <> 'pendente' then
    raise exception 'Só é possível remover item de um pedido ainda pendente.';
  end if;

  delete from pedido_itens where id = p_item_id and pedido_id = p_pedido_id;

  if not found then
    raise exception 'Item não encontrado nesse pedido.';
  end if;

  select coalesce(sum(preco_unitario * quantidade), 0) into v_novo_total
  from pedido_itens
  where pedido_id = p_pedido_id;

  -- Sem itens restantes: era o único item do pedido (o "pedido errado"
  -- inteiro), então remove o pedido também em vez de deixar um card vazio
  -- de R$ 0,00 na fila do balcão.
  if v_novo_total = 0 then
    delete from pedidos where id = p_pedido_id;
  else
    update pedidos set total = v_novo_total where id = p_pedido_id;
  end if;
end;
$$;

comment on function public.remover_item_pedido(uuid, bigint) is 'Remove um item de um pedido ainda pendente (cliente pediu errado) e recalcula o total; se era o último item, remove o pedido inteiro. Restrito a authenticated (tela do balcão).';

revoke all on function public.remover_item_pedido(uuid, bigint) from public;
grant execute on function public.remover_item_pedido(uuid, bigint) to authenticated;
