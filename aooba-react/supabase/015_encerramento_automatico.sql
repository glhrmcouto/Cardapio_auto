-- ========================================================================
-- AOOBA! BAR — encerramento automático da sessão ao quitar a conta
-- (migração 015)
-- Pré-requisitos: 009_fechamento_parcial.sql (pagamentos, fechar_parcial,
-- confirmar_pagamento, _conta_da_mesa_dados), 011_correcoes_saldo_e_concorrencia.sql
-- (encerrar_sessao por status em vez de saldo numérico, trava por
-- pg_advisory_xact_lock), 014_sessao_vinculada.sql (trava de sessão no
-- cliente).
--
-- ATÉ AQUI: a sessão só fechava com o garçom clicando manualmente em
-- "Conta Fechada" (encerrar_sessao), mesmo quando o saldo já tinha zerado
-- havia tempo — a mesa continuava em "Mesas Ativas" só esperando esse
-- clique.
--
-- A PARTIR DAQUI: confirmar_pagamento (o garçom confirmando que RECEBEU o
-- dinheiro de um "fechar minha parte") passa a checar, na mesma transação,
-- se essa confirmação foi a última pendência da sessão — se sim, encerra a
-- sessão sozinho, sem esperar o clique manual.
--
-- POR QUE "TODO MUNDO COM STATUS 'pago'" E NÃO O CAMPO NUMÉRICO
-- "saldo_restante": saldo_restante (ver _conta_da_mesa_dados) é
-- "total_geral - total_pago - total_pendente_confirmacao" — ele já desconta
-- os pagamentos PENDENTES (ainda não confirmados), então pode chegar a
-- zero no instante em que o ÚLTIMO CLIENTE clica em "fechar minha parte"
-- (criando o pagamento 'pendente'), antes de qualquer confirmação do
-- garçom. Isso contradiz a regra de negócio pedida — "o disparo é SEMPRE a
-- confirmação do balcão, nunca o clique do cliente" — então o gatilho real
-- usado aqui é "ninguém mais está 'em_aberto' nem 'aguardando' em
-- por_pessoa" (ou seja, todo mundo já pagou E teve o pagamento CONFIRMADO).
-- É a mesma escolha (por status, não por comparação numérica sujeita a
-- arredondamento) que 011_correcoes_saldo_e_concorrencia.sql já fez pro
-- botão manual — aqui é só a mesma régua aplicada ao gatilho automático,
-- o que também é o que a seção "CONSISTÊNCIA" do pedido original pede.
--
-- CONCORRÊNCIA: dois garçons confirmando os dois ÚLTIMOS pagamentos
-- pendentes de uma mesa quase ao mesmo tempo, em transações separadas, cada
-- um só enxerga o PRÓPRIO update ainda não commitado — nenhum dos dois
-- veria "todo mundo pago" sozinho, e a sessão nunca fecharia sozinha nesse
-- cenário. pg_advisory_xact_lock (mesmo padrão de fechar_parcial em
-- 011_correcoes_saldo_e_concorrencia.sql) serializa por sessão: a segunda
-- confirmação só recalcula depois que a primeira já commitou, então enxerga
-- o estado completo e fecha corretamente.
--
-- O QUE NÃO PRECISA MUDAR: o cliente (js/script.js) já assina a própria
-- sessão via Realtime e trava a tela quando ela vira 'fechada' (ver
-- supabase/014_sessao_vinculada.sql) — esse update de sessoes.status
-- dispara o mesmo evento, seja o encerramento manual ou automático, então
-- nenhuma mudança é necessária lá pra cobrir esse caso.
-- ========================================================================

-- ========================================================================
-- RPC: confirmar_pagamento (substitui a versão de 009_fechamento_parcial.sql)
-- ========================================================================
-- Muda de "returns pagamentos" pra "returns jsonb": além do pagamento
-- confirmado, o balcão (js/balcao.js) precisa saber SE essa confirmação
-- encerrou a sessão sozinha e de QUAL mesa, pra mostrar o feedback ("Mesa X
-- quitada e encerrada automaticamente") e já tirar a mesa da tela sem
-- esperar o Realtime ir e voltar. "drop" necessário porque o tipo de
-- retorno mudou (create or replace não permite isso).

drop function if exists public.confirmar_pagamento(uuid);

create or replace function public.confirmar_pagamento(p_pagamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagamento        pagamentos;
  v_dados            jsonb;
  v_todo_mundo_pago  boolean;
  v_mesa             int;
  v_encerrou         boolean := false;
begin
  update pagamentos
  set status = 'confirmado', confirmado_em = now()
  where id = p_pagamento_id and status = 'pendente'
  returning * into v_pagamento;

  if not found then
    raise exception 'Pagamento não encontrado ou já confirmado.';
  end if;

  -- Serializa por sessão (ver comentário de CONCORRÊNCIA no topo do
  -- arquivo) antes de decidir se essa foi a última pendência — mesmo padrão
  -- de dois hashtext (namespace + valor) de fechar_parcial em
  -- 011_correcoes_saldo_e_concorrencia.sql.
  perform pg_advisory_xact_lock(hashtext('confirmar_pagamento_sessao'), hashtext(v_pagamento.sessao_id::text));

  v_dados := public._conta_da_mesa_dados(v_pagamento.sessao_id);

  -- "Todo mundo pago" = ninguém com status 'em_aberto' (ainda não fechou a
  -- parte) nem 'aguardando' (fechou, mas o garçom ainda não confirmou). A
  -- checagem de array não-vazio evita encerrar por engano uma sessão sem
  -- nenhum pedido de verdade (não deveria acontecer aqui — ter um
  -- pagamento já implica ter pedido — mas é a mesma exigência explícita do
  -- pedido original, barato de garantir).
  select
    jsonb_array_length(v_dados -> 'por_pessoa') > 0
    and not exists (
      select 1
      from jsonb_array_elements(v_dados -> 'por_pessoa') as pessoa
      where pessoa ->> 'status' <> 'pago'
    )
  into v_todo_mundo_pago;

  if v_todo_mundo_pago then
    update pedidos
    set status = 'finalizado'
    where sessao_id = v_pagamento.sessao_id
      and status in ('pendente', 'entregue');

    update sessoes
    set status = 'fechada', fechada_em = now()
    where id = v_pagamento.sessao_id and status = 'aberta'
    returning mesa into v_mesa;

    v_encerrou := v_mesa is not null;
  end if;

  return jsonb_build_object(
    'pagamento', to_jsonb(v_pagamento),
    'sessao_encerrada', v_encerrou,
    'mesa', v_mesa
  );
end;
$$;

comment on function public.confirmar_pagamento(uuid) is 'Marca um pagamento pendente como confirmado (garçom recebeu o dinheiro) e, se essa foi a última pendência da sessão (ninguém mais em_aberto/aguardando), encerra a sessão automaticamente na mesma transação. Retorna {pagamento, sessao_encerrada, mesa}. Restrito a authenticated.';

revoke all on function public.confirmar_pagamento(uuid) from public;
grant execute on function public.confirmar_pagamento(uuid) to authenticated;

-- ========================================================================
-- RPC: encerrar_sessao (substitui a versão de 011_correcoes_saldo_e_concorrencia.sql)
-- ========================================================================
-- Mesma assinatura e mesma lógica de saldo/força de antes — muda só a
-- mensagem de "não há sessão aberta" pra "esta conta já foi encerrada",
-- porque agora esse caminho é bem mais comum: o botão manual "Conta
-- Fechada" pode ser clicado depois que o encerramento automático (acima)
-- já fechou a sessão sozinho (ex.: o garçom demorou um instante pra clicar
-- e nesse meio-tempo confirmou o último pagamento por outra tela). Ganha
-- "using detail" (mesma convenção de erro de SESSAO_ENCERRADA em
-- 014_sessao_vinculada.sql) pro balcão distinguir esse caso — que não é
-- erro, é só "já está tudo certo" — de uma falha de verdade.

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
    raise exception 'Esta conta já foi encerrada.' using detail = 'CONTA_JA_ENCERRADA';
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

comment on function public.encerrar_sessao(int, boolean) is 'Fecha a sessão aberta da mesa. Recusa com CONTA_JA_ENCERRADA se não houver sessão aberta (provavelmente já fechada pelo encerramento automático — ver 015_encerramento_automatico.sql). Recusa por saldo se existir alguém em_aberto, a menos que p_forcar=true. Restrito a authenticated.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 011_correcoes_saldo_e_concorrencia.sql,
-- os privilégios já concedidos lá continuam valendo.
