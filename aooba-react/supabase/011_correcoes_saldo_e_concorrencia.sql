-- ========================================================================
-- AOOBA! BAR — correções de auditoria: gatilho de saldo do encerrar_sessao
-- e condição de corrida no fechar_parcial (migração 011)
-- Pré-requisito: 010_taxa_servico_configuravel.sql.
-- ========================================================================

-- ========================================================================
-- FIX 1: encerrar_sessao — gatilho baseado em status, não em saldo numérico
-- ========================================================================
-- Antes: recusava fechar se saldo_restante > 0.02 (tolerância de 2 centavos
-- pro arredondamento do rateio). Problema: com vários itens compartilhados
-- divididos entre várias pessoas, o resíduo de arredondamento pode passar
-- de 2 centavos MESMO com todo mundo já tendo fechado a própria parte —
-- o garçom via "ainda falta R$ 0,03" sem ter de quem cobrar.
--
-- Agora: o gatilho é direto — existe alguém com status 'em_aberto' em
-- por_pessoa? Isso reflete a intenção de negócio real ("tem gente que não
-- fechou a conta ainda"), sem depender de comparação numérica sujeita a
-- arredondamento. A mensagem de erro mostra a soma exata do que falta
-- APENAS de quem está em_aberto (não o saldo_restante da sessão inteira,
-- que pode incluir esse mesmo resíduo).

create or replace function public.encerrar_sessao(p_mesa int, p_forcar boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessao_id uuid;
  v_dados     jsonb;
  v_lista     text;
  v_falta     numeric(10, 2);
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;

  if not found then
    raise exception 'Não há sessão aberta para a mesa %.', p_mesa;
  end if;

  v_dados := public._conta_da_mesa_dados(v_sessao_id);

  select
    string_agg((pessoa ->> 'nome') || ' (R$ ' || round((pessoa ->> 'valor')::numeric, 2)::text || ')', ', '),
    sum((pessoa ->> 'valor')::numeric)
  into v_lista, v_falta
  from jsonb_array_elements(v_dados -> 'por_pessoa') as pessoa
  where pessoa ->> 'status' = 'em_aberto';

  if v_lista is not null and not p_forcar then
    raise exception 'Ainda falta receber R$ % dessa mesa — %.', round(v_falta, 2)::text, v_lista;
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

comment on function public.encerrar_sessao(int, boolean) is 'Fecha a sessão aberta da mesa. Recusa se existir alguém com status em_aberto (não fechou a própria parte ainda), a menos que p_forcar=true. Restrito a authenticated.';

-- Sem "drop"/"grant" aqui de propósito: a assinatura não mudou desde
-- 009_fechamento_parcial.sql, então os privilégios (revoke de public, grant
-- pra authenticated) já concedidos lá continuam valendo — create or replace
-- não reseta permissões de um objeto já existente.

-- ========================================================================
-- FIX 2: fechar_parcial — trava a combinação mesa+pessoa até o fim da
-- transação
-- ========================================================================
-- Antes: um clique duplo (ou duas abas abertas na mesma sessão) podia fazer
-- duas chamadas quase simultâneas lerem os mesmos itens "ainda não pagos"
-- antes de qualquer UPDATE acontecer — as duas criavam um pagamento, mas o
-- segundo UPDATE sobrescrevia o vínculo do primeiro, sobrando um pagamento
-- "fantasma" sem nenhum item de verdade atrelado (e, pior, dois registros
-- de cobrança pro garçom confirmar por engano).
--
-- pg_advisory_xact_lock trava pela duração da transação atual (libera
-- sozinho no commit/rollback, sem precisar de unlock manual): a segunda
-- chamada só continua depois que a primeira já terminou, e por essa altura
-- os itens já estão vinculados ao primeiro pagamento — a segunda
-- simplesmente não encontra mais nada em aberto pra cobrar (cai no "Você
-- não tem nada em aberto nessa mesa", em vez de duplicar o pagamento).

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

  perform pg_advisory_xact_lock(hashtext('fechar_parcial:' || p_mesa::text), hashtext(p_cliente_id::text));

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

comment on function public.fechar_parcial(int, text, uuid, boolean) is 'Fecha a parte de uma pessoa: congela subtotal, taxa de serviço (0 se recusada) e o total num pagamento pendente, e vincula os itens/rateios a ele. Trava mesa+pessoa (pg_advisory_xact_lock) até o fim da transação, pra clique duplo não gerar dois pagamentos pros mesmos itens.';

-- Sem "drop"/"grant" aqui de propósito: mesma assinatura de
-- 010_taxa_servico_configuravel.sql, os privilégios já concedidos lá
-- continuam valendo.
