-- ========================================================================
-- AOOBA! BAR — controle de liberação de mesa pelo balcão (migração 019)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
-- Pré-requisitos: 005_seguranca.sql (tabela mesas, criar_pedido),
-- 009_fechamento_parcial.sql (encerrar_sessao), 015_encerramento_automatico.sql
-- (confirmar_pagamento, encerramento automático), 017_token_sessao.sql
-- (abrir_sessao, sessao_atual, criar_pedido atual).
--
-- PROBLEMA: depois que uma mesa fecha a conta, qualquer um que ainda tenha
-- (ou consiga adivinhar/reaproveitar) o link do QR físico dela pode escanear
-- de novo e abrir uma sessão nova — mesmo sem estar fisicamente sentado ali.
-- O bloqueio por sessionStorage/localStorage (ver js/script.js,
-- aooba_encerrada) trava só QUEM TINHA a sessão anterior; não impede uma
-- pessoa de má-fé, com o link em mãos mas sem tê-lo usado antes, de abrir
-- uma sessão nova em qualquer mesa já usada.
--
-- SOLUÇÃO: depois de um fechamento TOTAL (garçom clica "Conta Fechada", ou o
-- encerramento automático quando o último pagamento é confirmado — ver
-- 015), a mesa some do sistema pro cliente (abrir_sessao/criar_pedido
-- recusam) até um garçom confirmar, no balcão, que tem gente de verdade
-- sentada ali e liberar a mesa de novo.
--
-- FLUXO COMPLETO:
--   1. Grupo pede, fecha a conta total (encerrar_sessao, manual ou
--      automático) -> mesa vira 'bloqueada' sozinha, na mesma transação.
--   2. Cliente novo senta na mesa, escaneia o QR -> sessao_atual não acha
--      sessão aberta E status_da_mesa diz 'bloqueada' -> cardápio mostra
--      "Mesa aguardando liberação — chame um atendente" (sem cardápio, sem
--      carrinho, sem pedido).
--   3. O garçom vê a mesa marcada como bloqueada no painel do balcão,
--      confirma que tem gente sentada ali de verdade e toca "Liberar mesa"
--      (liberar_mesa) -> status_mesa volta a 'liberada'.
--   4. O cliente agora consegue "Iniciar pedido" normalmente (na hora, se a
--      tela estiver com o polling ativo — ver mostrarMesaBloqueada em
--      js/script.js —, ou ao recarregar a página).
--   5. Alguém de má-fé, em casa, que escaneia uma mesa bloqueada fica preso
--      em "aguardando liberação" pra sempre — o garçom nunca vai liberar
--      uma mesa que sabe estar vazia. Furo fechado.
--
-- status_mesa é INDEPENDENTE de "ativa" (mesas.ativa já existia desde
-- 005_seguranca.sql): "ativa" é a mesa EXISTIR no sistema (uma mesa
-- desativada nem aparece pro cliente, ponto final); "status_mesa" é estar
-- liberada pra aceitar pedido AGORA, numa mesa que existe e está em uso
-- normal. Uma mesa pode estar ativa E bloqueada (aguardando o garçom).
-- ========================================================================

-- ========================================================================
-- COLUNA: mesas.status_mesa
-- ========================================================================
-- DEFAULT 'liberada' de propósito: o sistema não pode nascer com toda mesa
-- bloqueada (travaria a estreia do bar) — o bloqueio só passa a valer a
-- PARTIR do primeiro fechamento total de cada mesa. "add column ... default"
-- já preenche as linhas existentes com o default sozinho (Postgres 11+, sem
-- reescrever a tabela inteira), mas o UPDATE abaixo deixa isso explícito e
-- documentado, e é seguro rodar de novo (idempotente).

alter table mesas
  add column if not exists status_mesa text not null default 'liberada'
    check (status_mesa in ('liberada', 'bloqueada'));

update mesas set status_mesa = 'liberada' where status_mesa is null;

comment on column mesas.status_mesa is 'Se a mesa aceita abrir sessão/pedido AGORA. "bloqueada" depois de um fechamento total, até um garçom confirmar presença e liberar de novo (ver liberar_mesa). Independente de "ativa" (mesa existir no sistema).';

-- ========================================================================
-- FUNÇÃO PRIVADA: _bloquear_mesa
-- ========================================================================
-- Chamada só internamente, de dentro de encerrar_sessao e confirmar_pagamento
-- (os dois caminhos que fecham uma sessão de fato — manual e automático) —
-- nunca exposta direto pro cliente nem pro balcão. Mesmo padrão de
-- _sessao_aberta_por_token (017) e _conta_da_mesa_dados (009): sem
-- "revoke all ... grant", só "revoke all from public" — o dono da função
-- (quem roda esta migração) sempre pode chamá-la de dentro de outra
-- SECURITY DEFINER, sem precisar de grant explícito.

create or replace function public._bloquear_mesa(p_mesa int)
returns void
language sql
security definer
set search_path = public
as $$
  update mesas set status_mesa = 'bloqueada' where numero = p_mesa;
$$;

revoke all on function public._bloquear_mesa(int) from public;

-- ========================================================================
-- RPC: encerrar_sessao (substitui a versão de 015_encerramento_automatico.sql)
-- ========================================================================
-- Mesma assinatura e mesma lógica de saldo/força de antes — só ganha a
-- chamada a _bloquear_mesa depois de fechar a sessão com sucesso (fechamento
-- manual, botão "Conta Fechada" no balcão).

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

  -- Fechamento TOTAL de verdade (não um "conta já encerrada" sem-efeito
  -- acima) — bloqueia a mesa até o garçom liberar de novo (ver FLUXO
  -- COMPLETO no topo do arquivo).
  perform public._bloquear_mesa(p_mesa);
end;
$$;

comment on function public.encerrar_sessao(int, boolean) is 'Fecha a sessão aberta da mesa e BLOQUEIA a mesa (status_mesa=''bloqueada'', ver 019_bloqueio_mesa.sql) até liberar_mesa. Recusa com CONTA_JA_ENCERRADA se não houver sessão aberta. Recusa por saldo se existir alguém em_aberto, a menos que p_forcar=true. Restrito a authenticated.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 015_encerramento_automatico.sql,
-- os privilégios já concedidos lá continuam valendo.

-- ========================================================================
-- RPC: confirmar_pagamento (substitui a versão de 015_encerramento_automatico.sql)
-- ========================================================================
-- Mesma lógica de antes — só ganha a chamada a _bloquear_mesa quando essa
-- confirmação foi a que encerrou a sessão sozinha (encerramento automático).

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

  perform pg_advisory_xact_lock(hashtext('confirmar_pagamento_sessao'), hashtext(v_pagamento.sessao_id::text));

  v_dados := public._conta_da_mesa_dados(v_pagamento.sessao_id);

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

    if v_encerrou then
      -- Mesmo bloqueio de encerrar_sessao (manual), pro fechamento
      -- automático também mandar a mesa pra "aguardando liberação" — ver
      -- FLUXO COMPLETO no topo do arquivo.
      perform public._bloquear_mesa(v_mesa);
    end if;
  end if;

  return jsonb_build_object(
    'pagamento', to_jsonb(v_pagamento),
    'sessao_encerrada', v_encerrou,
    'mesa', v_mesa
  );
end;
$$;

comment on function public.confirmar_pagamento(uuid) is 'Marca um pagamento pendente como confirmado e, se foi a última pendência da sessão, encerra a sessão E bloqueia a mesa (status_mesa=''bloqueada'', ver 019_bloqueio_mesa.sql) automaticamente. Retorna {pagamento, sessao_encerrada, mesa}. Restrito a authenticated.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 015_encerramento_automatico.sql,
-- os privilégios já concedidos lá continuam valendo.

-- ========================================================================
-- RPC: liberar_mesa
-- ========================================================================
-- Único caminho pra tirar uma mesa de 'bloqueada' — sempre sob toque
-- explícito do garçom no balcão, depois de confirmar que tem gente sentada
-- de verdade ali (ver painel "Controle de Mesas" em balcao.html). Já deixa
-- a mesa pronta pra abrir sessão nova no próximo scan: não precisa de mais
-- nenhuma ação além desta.

create or replace function public.liberar_mesa(p_mesa int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  update mesas set status_mesa = 'liberada' where numero = p_mesa;

  if not found then
    raise exception 'Mesa % não encontrada.', p_mesa;
  end if;
end;
$$;

comment on function public.liberar_mesa(int) is 'Libera uma mesa bloqueada (status_mesa=''liberada''), permitindo abrir sessão/pedido nela de novo. Único caminho de desbloqueio — sempre sob toque explícito do garçom no balcão. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de encerrar_sessao).';

revoke all on function public.liberar_mesa(int) from public;
grant execute on function public.liberar_mesa(int) to authenticated;

-- ========================================================================
-- RPC: status_da_mesa
-- ========================================================================
-- Consulta leve pro cliente (anon) saber se a mesa está bloqueada ANTES de
-- tentar abrir sessão — usada em js/script.js quando sessao_atual não acha
-- sessão aberta, pra decidir entre "Mesa aguardando liberação",
-- "Bem-vindo" ou "Conta encerrada". Mesma checagem de token de mesa que
-- toda RPC de anon exige (nunca vaza o status de uma mesa sem o token
-- certo).

create or replace function public.status_da_mesa(p_mesa int, p_token text)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_mesa mesas;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar a mesa. Verifique o QR code da mesa.';
  end if;

  return v_mesa.status_mesa;
end;
$$;

comment on function public.status_da_mesa(int, text) is 'Devolve status_mesa (liberada/bloqueada) da mesa, exigindo o token da mesa. Usado pelo cliente pra decidir a tela quando não há sessão aberta.';

revoke all on function public.status_da_mesa(int, text) from public;
grant execute on function public.status_da_mesa(int, text) to anon;

-- ========================================================================
-- RPC: listar_mesas_balcao
-- ========================================================================
-- Alimenta o painel "Controle de Mesas" do balcão. Devolve só numero/
-- status_mesa/ativa — NUNCA o token: mesas já tem RLS restrita a admin
-- (mesas_select_admin, 005_seguranca.sql) justamente pra não vazar o
-- token pra qualquer conta autenticada, e balcao.html aceita QUALQUER
-- conta autenticada, não só admin (ver comentário no fim de
-- 003_admin.sql) — por isso uma RPC própria em vez de abrir uma policy de
-- SELECT direta na tabela.

create or replace function public.listar_mesas_balcao()
returns table (numero int, status_mesa text, ativa boolean)
language sql
security definer
stable
set search_path = public
as $$
  select numero, status_mesa, ativa
  from mesas
  order by numero;
$$;

comment on function public.listar_mesas_balcao() is 'Lista número/status_mesa/ativa de todas as mesas pro painel "Controle de Mesas" do balcão — nunca o token. Restrito a authenticated.';

revoke all on function public.listar_mesas_balcao() from public;
grant execute on function public.listar_mesas_balcao() to authenticated;

-- ========================================================================
-- RPC: abrir_sessao (substitui a versão de 017_token_sessao.sql)
-- ========================================================================
-- Mesma lógica de antes — só ganha a checagem de status_mesa logo após
-- validar mesa+token, antes de qualquer coisa: mesa bloqueada nunca abre
-- sessão nova, nem por engano de concorrência (dois toques quase juntos).

create or replace function public.abrir_sessao(p_mesa int, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa       mesas;
  v_sessao_id  uuid;
  v_token      text;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Não foi possível iniciar o pedido. Verifique o QR code da mesa.';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível iniciar o pedido. Verifique o QR code da mesa.';
  end if;

  if v_mesa.status_mesa = 'bloqueada' then
    raise exception 'Mesa aguardando liberação do atendente.' using detail = 'MESA_BLOQUEADA';
  end if;

  insert into sessoes (mesa) values (p_mesa)
  on conflict (mesa) where status = 'aberta' do nothing;

  select s.id, t.token_sessao into v_sessao_id, v_token
  from sessoes s
  join sessao_tokens t on t.sessao_id = s.id
  where s.mesa = p_mesa and s.status = 'aberta'
  limit 1;

  return jsonb_build_object('sessao_id', v_sessao_id, 'token_sessao', v_token);
end;
$$;

comment on function public.abrir_sessao(int, text) is 'Abre uma sessão nova pra mesa (ou entrega o token da que já estiver aberta) e devolve {sessao_id, token_sessao}. Recusa com MESA_BLOQUEADA se status_mesa=''bloqueada'' (ver 019_bloqueio_mesa.sql). Único caminho de criação de sessão pro cliente, sempre sob toque explícito.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 017_token_sessao.sql, os
-- privilégios já concedidos lá continuam valendo.

-- ========================================================================
-- RPC: criar_pedido (substitui a versão de 017_token_sessao.sql)
-- ========================================================================
-- Mesma lógica de antes — só ganha a checagem de status_mesa, defesa a
-- mais (redundante na prática: uma mesa bloqueada não deveria ter sessão
-- aberta nenhuma, então o token_sessao já seria recusado logo depois; mas
-- pedido explícito é cobrir também qualquer cenário em que uma sessão
-- ainda esteja aberta no exato instante em que a mesa é bloqueada).

create or replace function public.criar_pedido(
  p_mesa          int,
  p_token         text,
  p_itens         jsonb,
  p_cliente_nome  text,
  p_cliente_id    uuid,
  p_token_sessao  text default null
)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  -- ==== LIMITES DE FREQUÊNCIA — ajuste aqui, sem mexer no resto da função ====
  v_limite_pedidos_pessoa  constant int := 5;   -- por cliente_id, em 2 minutos
  v_limite_pedidos_mesa    constant int := 20;  -- por mesa (rede de segurança), em 2 minutos
  -- ============================================================================

  v_pedido                  pedidos;
  v_mesa                    mesas;
  v_sessao_id               uuid;
  v_pedidos_recentes_pessoa int;
  v_pedidos_recentes_mesa   int;
  v_total                   numeric(10, 2) := 0;
  v_total_itens             int := 0;
  v_item                    jsonb;
  v_produto                 produtos;
  v_quantidade              int;
  v_compartilhado           boolean;
  v_nome_limpo              text;
  v_pedido_item_id          bigint;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  if v_mesa.status_mesa = 'bloqueada' then
    raise exception 'Mesa aguardando liberação do atendente.' using detail = 'MESA_BLOQUEADA';
  end if;

  -- Token de SESSÃO (autorização de pedir nesta rodada — não confundir com
  -- o token DA MESA checado acima, que só identifica a mesa; ver comentário
  -- no topo de 017_token_sessao.sql). Checado logo após a mesa/token/bloqueio,
  -- antes de qualquer validação de negócio: sem sessão aberta válida, nada
  -- mais importa. Nunca abre sessão sozinho aqui — isso só acontece em
  -- abrir_sessao, sob toque explícito do cliente.
  v_sessao_id := public._sessao_aberta_por_token(p_mesa, p_token_sessao);
  if v_sessao_id is null then
    raise exception 'Esta conta foi encerrada.' using detail = 'SESSAO_ENCERRADA';
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

  -- Limite POR PESSOA (pega spam de um aparelho só) — checado primeiro
  -- porque é o caso comum.
  select count(*) into v_pedidos_recentes_pessoa
  from pedidos
  where cliente_id = p_cliente_id
    and tipo = 'pedido'
    and criado_em > now() - interval '2 minutes';

  if v_pedidos_recentes_pessoa >= v_limite_pedidos_pessoa then
    raise exception 'Aguarde um instante antes de fazer outro pedido.';
  end if;

  -- Limite POR MESA (rede de segurança, teto bem mais alto).
  select count(*) into v_pedidos_recentes_mesa
  from pedidos
  where mesa = p_mesa
    and tipo = 'pedido'
    and criado_em > now() - interval '2 minutes';

  if v_pedidos_recentes_mesa >= v_limite_pedidos_mesa then
    raise exception 'Muita gente pedindo nessa mesa ao mesmo tempo. Aguarde um instante e tente de novo.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  -- 1ª passada: valida TODOS os itens, soma a quantidade total e calcula o
  -- total em dinheiro antes de gravar qualquer coisa.
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

  insert into pedidos (tipo, mesa, total, status, sessao_id, cliente_nome, cliente_id)
  values ('pedido', p_mesa, v_total, 'pendente', v_sessao_id, v_nome_limpo, p_cliente_id)
  returning * into v_pedido;

  -- 2ª passada: agora grava os itens, já sabendo que todos são válidos
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
      -- Elegibilidade por NOME normalizado (ver 013_agrupar_por_nome.sql):
      -- junta os cliente_id que já usaram o mesmo nome nessa sessão antes de
      -- decidir quem "ainda está na mesa".
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

comment on function public.criar_pedido(int, text, jsonb, text, uuid, text) is 'Único caminho de escrita de pedidos pro cliente (anon). Recusa com MESA_BLOQUEADA se status_mesa=''bloqueada'' (ver 019_bloqueio_mesa.sql), com SESSAO_ENCERRADA sem token_sessao válido. Limita frequência por pessoa e por mesa.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 017_token_sessao.sql, os
-- privilégios já concedidos lá continuam valendo.

-- ========================================================================
-- REALTIME: por que "mesas" NÃO entra em supabase_realtime
-- ========================================================================
-- mesas.token é secreto (RLS restrita a admin — mesas_select_admin, ver
-- 005_seguranca.sql) e o Postgres Changes do Supabase manda a linha
-- INTEIRA em todo evento — não dá pra publicar só numero/status_mesa sem
-- reestruturar a tabela (token numa tabela separada, fora do escopo desta
-- migração). Por isso:
--   - Balcão: o painel "Controle de Mesas" (listar_mesas_balcao) atualiza
--     de novo sempre que o balcão recebe um evento de "sessoes" virando
--     'fechada' (canal que já existe, ver js/balcao.js) — cobre o caso
--     "mesa acabou de ser bloqueada" sem precisar de um canal novo.
--   - Cliente: a tela "Mesa aguardando liberação" faz polling periódico de
--     status_da_mesa (RPC leve, sem segredo nenhum no retorno) em vez de
--     assinar Realtime — ver mostrarMesaBloqueada em js/script.js.
