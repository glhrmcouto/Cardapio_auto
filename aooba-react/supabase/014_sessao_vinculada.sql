-- ========================================================================
-- AOOBA! BAR — vínculo de sessão no navegador do cliente (migração 014)
-- Pré-requisitos: 008_sessoes.sql (tabela sessoes, pedidos.sessao_id),
-- 009_fechamento_parcial.sql (pagamentos, fechar_parcial),
-- 012_realtime_sessoes.sql (realtime na tabela sessoes).
--
-- BUG QUE ESTA MIGRAÇÃO CORRIGE — "mesa que vira": o cardápio do cliente
-- nunca carregava a identidade da sessão em que foi aberto; criar_pedido só
-- olhava pra "qual é a sessão aberta da mesa AGORA" (por número da mesa),
-- não "em qual sessão esse celular específico estava". Resultado: se o
-- garçom fechasse a conta de uma mesa (encerrar_sessao) e um cliente novo
-- sentasse ali na sequência, um celular antigo que ainda estivesse com o
-- cardápio aberto (do grupo que já saiu) conseguia mandar pedido — e esse
-- pedido caía direto na comanda do cliente NOVO, porque as duas coisas só
-- eram amarradas pelo número da mesa.
--
-- A PARTIR DAQUI: todo pedido/fechamento do cliente carrega o session_id
-- que o navegador tem guardado. Se esse session_id não bater com a sessão
-- aberta ATUAL da mesa (foi encerrada, ou nunca existiu, ou é de outra
-- mesa), o servidor recusa com um erro identificável ('SESSAO_ENCERRADA',
-- ver a convenção de erro logo abaixo) em vez de aceitar o pedido às cegas.
-- Só quando o navegador ainda não tem NENHUM session_id (primeiro pedido de
-- um scan novo) é que o servidor localiza a sessão aberta da mesa ou abre
-- uma nova — exatamente como já funcionava antes desta migração.
--
-- IMPORTANTE, pra não confundir com uma trava de "uma pessoa por vez":
-- fechar_parcial (fechamento de UMA pessoa) não muda sessoes.status — a
-- sessão continua 'aberta' e todo mundo mais na mesa segue pedindo
-- normalmente com o MESMO session_id. Só encerrar_sessao (fechamento TOTAL
-- da mesa, que já exige saldo zerado — ver 011_correcoes_saldo_e_concorrencia.sql)
-- muda a sessão pra 'fechada'. Ou seja: com a mesa aberta, N pessoas
-- pedindo ao mesmo tempo com o mesmo session_id é o fluxo NORMAL — nenhum
-- desses pedidos deve cair em SESSAO_ENCERRADA. Essa recusa só acontece pra
-- quem carrega um session_id de uma sessão que já passou por encerramento
-- TOTAL.
--
-- CONVENÇÃO DE ERRO: as três RPCs abaixo recusam sessão inválida/encerrada
-- com "raise exception ... using detail = 'SESSAO_ENCERRADA'". A MENSAGEM
-- (texto amigável) fica em error.message, pra mostrar direto se algo cair
-- num catch genérico; o CÓDIGO MÁQUINA fica em error.details (é onde o
-- Postgres/PostgREST colocam o DETAIL de uma exceção) — é isso que o
-- cardápio usa pra decidir "isso é sessão encerrada, mostra o overlay",
-- sem depender do texto exato da mensagem (ver js/script.js,
-- ehErroSessaoEncerrada).
-- ========================================================================

-- ========================================================================
-- RLS: sessoes — leitura anon (só pra trava em tempo real, item 3)
-- ========================================================================
-- Até aqui só authenticated lia "sessoes" direto (o cliente sempre passava
-- pelas RPCs, todas SECURITY DEFINER). A trava em tempo real do cardápio
-- (js/script.js, inscreverRealtimeSessao) precisa assinar mudanças na
-- PRÓPRIA sessão via Postgres Changes — e o Realtime da Supabase só entrega
-- uma linha pra uma conexão se existir policy de SELECT liberando ela pro
-- role da conexão (anon, no caso do cliente); sem isso, o evento de "sessão
-- fechou" nunca chegaria no navegador. A tabela não guarda nada sensível
-- (sem token, sem valor em dinheiro — só id/mesa/horários/status), então
-- liberar SELECT geral pra anon aqui não abre brecha que a RPC
-- conta_da_mesa (protegida por token) já não expusesse de outro jeito.
create policy "sessoes_select_anon"
  on sessoes for select
  to anon
  using (true);

-- ========================================================================
-- RPC: sessao_atual
-- ========================================================================
-- Devolve o id da sessão aberta da mesa (ou null, se ainda ninguém pediu
-- nela). Chamada pelo cardápio ao carregar a página e de novo depois de
-- "Iniciar novo pedido" (ver item 2), pra saber a qual sessão os próximos
-- pedidos devem se vincular.

create or replace function public.sessao_atual(p_mesa int, p_token text)
returns uuid
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

  return (select id from sessoes where mesa = p_mesa and status = 'aberta' limit 1);
end;
$$;

comment on function public.sessao_atual(int, text) is 'Id da sessão aberta atual da mesa (ou null). Exige o token da mesa. Usado pelo cardápio pra saber a qual sessão vincular os próximos pedidos e pra destravar a tela depois de "Iniciar novo pedido".';

revoke all on function public.sessao_atual(int, text) from public;
grant execute on function public.sessao_atual(int, text) to anon;

-- ========================================================================
-- RPC: criar_pedido (substitui a versão de 013_agrupar_por_nome.sql)
-- ========================================================================
-- Ganha p_session_id (default null). Com ele preenchido, exige que essa
-- sessão exista, seja da mesa informada e esteja 'aberta' — senão recusa
-- com SESSAO_ENCERRADA, sem gravar nada. Só com p_session_id nulo o
-- servidor volta a localizar/abrir a sessão da mesa sozinho (mesmo
-- comportamento de antes desta migração). O pedido retornado já inclui
-- sessao_id (coluna que já existia em "pedidos" desde 008_sessoes.sql) —
-- é isso que o cardápio usa pra saber qual session_id guardar dali em diante.

drop function if exists public.criar_pedido(int, text, jsonb, text, uuid);

create or replace function public.criar_pedido(
  p_mesa         int,
  p_token        text,
  p_itens        jsonb,
  p_cliente_nome text,
  p_cliente_id   uuid,
  p_session_id   uuid default null
)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido            pedidos;
  v_mesa              mesas;
  v_sessao            sessoes;
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

  -- Vínculo de sessão (corrige o bug de "mesa que vira" — ver comentário no
  -- topo deste arquivo). session_id vindo do navegador precisa ser da
  -- sessão aberta ATUAL dessa mesa; se não for (sessão já encerrada, id de
  -- outra mesa, ou um id que não existe), recusa aqui, sem gravar pedido
  -- nenhum. Repare que isso NÃO tem nada a ver com fechamento parcial
  -- (fechar_parcial não muda sessoes.status — ver 009_fechamento_parcial.sql):
  -- com a mesa aberta, várias pessoas pedindo com o mesmo session_id é o
  -- fluxo normal, e nenhuma delas cai aqui.
  if p_session_id is not null then
    select * into v_sessao from sessoes where id = p_session_id;
    if not found or v_sessao.mesa is distinct from p_mesa or v_sessao.status <> 'aberta' then
      raise exception 'Esta conta foi encerrada.' using detail = 'SESSAO_ENCERRADA';
    end if;
    v_sessao_id := v_sessao.id;
  else
    -- Só quando o navegador ainda não tem session_id nenhum (primeiro
    -- pedido de um scan novo): reaproveita a sessão aberta da mesa se já
    -- existir; senão abre uma nova na hora. O "on conflict" mira o índice
    -- único parcial idx_sessoes_mesa_aberta_unica, então dois pedidos quase
    -- simultâneos pra uma mesa sem sessão ainda não abrem duas em paralelo.
    insert into sessoes (mesa) values (p_mesa)
    on conflict (mesa) where status = 'aberta' do nothing;

    select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;
  end if;

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

comment on function public.criar_pedido(int, text, jsonb, text, uuid, uuid) is 'Único caminho de escrita de pedidos pro cliente (anon). Exige que p_session_id (quando informado) seja da sessão aberta atual da mesa — senão recusa com SESSAO_ENCERRADA (ver comentário no topo de 014_sessao_vinculada.sql). Só localiza/abre sessão sozinho quando p_session_id vem nulo.';

grant execute on function public.criar_pedido(int, text, jsonb, text, uuid, uuid) to anon;

-- ========================================================================
-- RPC: pedir_fechamento (substitui a versão de 008_sessoes.sql)
-- ========================================================================
-- Mesma checagem de sessão de criar_pedido: com p_session_id preenchido,
-- exige que seja a sessão aberta atual da mesa; com ele nulo, localiza/abre
-- sozinho (caso raro de pedir fechamento sem nunca ter feito um pedido).

drop function if exists public.pedir_fechamento(int, text);

create or replace function public.pedir_fechamento(p_mesa int, p_token text, p_session_id uuid default null)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa       mesas;
  v_sessao     sessoes;
  v_sessao_id  uuid;
  v_existente  pedidos;
  v_novo       pedidos;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Não foi possível processar sua solicitação. Verifique o QR code da mesa.';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível processar sua solicitação. Verifique o QR code da mesa.';
  end if;

  if p_session_id is not null then
    select * into v_sessao from sessoes where id = p_session_id;
    if not found or v_sessao.mesa is distinct from p_mesa or v_sessao.status <> 'aberta' then
      raise exception 'Esta conta foi encerrada.' using detail = 'SESSAO_ENCERRADA';
    end if;
    v_sessao_id := v_sessao.id;
  else
    insert into sessoes (mesa) values (p_mesa)
    on conflict (mesa) where status = 'aberta' do nothing;

    select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;
  end if;

  select * into v_existente
  from pedidos
  where tipo = 'fechar_conta'
    and mesa = p_mesa
    and status = 'pendente'
  order by criado_em desc
  limit 1;

  if found then
    return v_existente;
  end if;

  insert into pedidos (tipo, mesa, total, status, sessao_id)
  values ('fechar_conta', p_mesa, 0, 'pendente', v_sessao_id)
  returning * into v_novo;

  return v_novo;
end;
$$;

comment on function public.pedir_fechamento(int, text, uuid) is 'Registra o pedido de fechamento de conta da mesa (exige token da mesa e, se informado, que p_session_id seja a sessão aberta atual — senão recusa com SESSAO_ENCERRADA); devolve o existente se já houver um pendente, em vez de duplicar o alerta no balcão.';

grant execute on function public.pedir_fechamento(int, text, uuid) to anon;

-- ========================================================================
-- RPC: conta_da_mesa (substitui a versão de 009_fechamento_parcial.sql)
-- ========================================================================
-- Ganha p_session_id (default null). Informado, precisa ser a sessão aberta
-- atual da mesa — senão recusa com SESSAO_ENCERRADA, em vez de mostrar (por
-- engano) a conta do grupo novo pra quem ficou com a página antiga aberta.
-- Nulo (cliente ainda não tem session_id guardado) segue mostrando a sessão
-- aberta da mesa, igual antes desta migração.

drop function if exists public.conta_da_mesa(int, text, uuid);

create or replace function public.conta_da_mesa(p_mesa int, p_token text, p_cliente_id uuid default null, p_session_id uuid default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_mesa      mesas;
  v_sessao    sessoes;
  v_sessao_id uuid;
  v_resultado jsonb;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar sua conta. Verifique o QR code da mesa.';
  end if;

  if p_session_id is not null then
    select * into v_sessao from sessoes where id = p_session_id;
    if not found or v_sessao.mesa is distinct from p_mesa or v_sessao.status <> 'aberta' then
      raise exception 'Esta conta foi encerrada.' using detail = 'SESSAO_ENCERRADA';
    end if;
    v_sessao_id := v_sessao.id;
  else
    select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta';
  end if;

  v_resultado := public._conta_da_mesa_dados(v_sessao_id);

  if p_cliente_id is not null then
    v_resultado := v_resultado || jsonb_build_object(
      'minha_parte', public._minha_parte_dados(v_sessao_id, p_cliente_id)
    );
  end if;

  return v_resultado;
end;
$$;

comment on function public.conta_da_mesa(int, text, uuid, uuid) is 'Itens, totais (geral/pago/aguardando/saldo) e resumo por pessoa da sessão aberta da mesa. Com p_cliente_id, inclui "minha_parte". Com p_session_id, exige que seja a sessão aberta atual — senão recusa com SESSAO_ENCERRADA. Exige o token da mesa.';

grant execute on function public.conta_da_mesa(int, text, uuid, uuid) to anon;
