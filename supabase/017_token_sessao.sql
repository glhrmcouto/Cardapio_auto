-- ========================================================================
-- AOOBA! BAR — token de SESSÃO rotativo, separado do token DA MESA
-- (migração 017)
-- Pré-requisitos: 005_seguranca.sql (mesas.token), 008_sessoes.sql (tabela
-- sessoes), 014_sessao_vinculada.sql (vínculo de sessão no cliente,
-- convenção de erro SESSAO_ENCERRADA), 016_rate_limit_por_pessoa.sql
-- (última versão de criar_pedido antes desta migração).
--
-- CONCEITO — dois tokens com papéis diferentes, que até aqui estavam
-- misturados num só:
--   - TOKEN DA MESA (mesas.token, já existe desde 005_seguranca.sql): vai no
--     QR impresso (?mesa=N&t=TOKEN_MESA). PERMANENTE — nunca muda, o adesivo
--     na mesa continua valendo pra sempre. Serve só pra identificar "esta
--     requisição é da mesa N", não autoriza nada por si só.
--   - TOKEN DE SESSÃO (novo, sessao_tokens.token_sessao): nasce quando uma
--     sessão abre e só vale enquanto ela estiver 'aberta'. É ele que
--     AUTORIZA pedir/fechar conta numa sessão específica.
--
-- O QUE ISSO CORRIGE: antes desta migração, o "vínculo de sessão" (ver
-- 014_sessao_vinculada.sql) usava sessoes.id — a chave primária — como se
-- fosse um segredo. Funcionava por acaso (é um uuid aleatório), mas nunca
-- foi desenhado pra ser um credential: sessoes já é lida direto por anon
-- (policy "sessoes_select_anon" em 014, necessária pro Realtime da trava) e
-- section 012 publica a tabela inteira no Realtime — ou seja, o "segredo"
-- estava exposto por design. Esta migração separa as duas coisas: sessoes
-- continua pública (id/mesa/horários/status — nada sensível, ver comentário
-- de 014) e o token de verdade mora numa tabela própria, SEM NENHUMA policy
-- de leitura pra ninguém — só entra/sai de lá através das RPCs abaixo.
--
-- FLUXO NOVO NO CLIENTE (ver js/script.js):
--   1. Carrega com ?mesa=N&t=TOKEN_MESA (token da mesa, igual sempre foi).
--   2. Chama sessao_atual(mesa, token_mesa):
--      - sessão aberta agora -> devolve {sessao_id, token_sessao}. O
--        cliente adota esse token na hora (é seguro: só chegou até aqui
--        porque tinha o token DA MESA certo, ou seja, escaneou o QR físico
--        dela) — cobre tanto "sou eu voltando" quanto "sou um amigo novo
--        entrando na mesma rodada".
--      - nenhuma sessão aberta -> devolve null. O cliente NUNCA abre sessão
--        sozinho aqui: trava a tela com "Iniciar novo pedido na Mesa N?" e
--        só chama abrir_sessao() no toque explícito do botão.
--   3. criar_pedido/pedir_fechamento/conta_da_mesa passam a exigir
--      p_token_sessao (em vez do antigo p_session_id/uuid) e validam que ele
--      corresponde a uma sessão 'aberta' DAQUELA mesa — sem isso, recusam
--      com SESSAO_ENCERRADA (mesma convenção de erro de 014, sem mudança
--      nenhuma no lado do cliente que já trata esse caso).
--
-- O FURO DO F5 (o motivo desta migração existir): cliente fecha a conta,
-- token_sessao dele morre junto (a sessão deixa de estar 'aberta' — não
-- precisa de nenhuma limpeza extra, é automático: ver _sessao_aberta_por_token
-- abaixo). Um F5 depois, em casa, com a mesma URL ?mesa=N&t=TOKEN_MESA:
-- o token da mesa continua batendo (é permanente, de propósito), mas o
-- token_sessao guardado não serve mais pra nenhuma sessão aberta -> recusa.
-- O cardápio não libera sozinho; só um toque intencional em "Iniciar novo
-- pedido" (nenhuma sessão aberta pra essa mesa no momento) gera um
-- token_sessao novo.
-- ========================================================================

-- ========================================================================
-- TABELA: sessao_tokens
-- ========================================================================
-- Separada de "sessoes" DE PROPÓSITO (ver comentário no topo do arquivo):
-- "sessoes" é legível direto por anon (RLS "true", 014_sessao_vinculada.sql)
-- pra alimentar a trava em tempo real, e essa tabela não pode carregar nada
-- secreto. token_sessao só nasce/é lido através das RPCs SECURITY DEFINER
-- abaixo — nunca por SELECT direto de anon nem authenticated.

create table sessao_tokens (
  sessao_id    uuid primary key references sessoes (id),
  token_sessao text not null unique default encode(gen_random_bytes(16), 'hex')
);

comment on table sessao_tokens is 'Token de sessão (segredo temporário que autoriza pedir/fechar conta numa sessão aberta) — separado de "sessoes" porque aquela tabela é lida direto por anon (Realtime da trava) e esta não pode ser. Só acessível via RPC SECURITY DEFINER.';

alter table sessao_tokens enable row level security;

-- Sem NENHUMA policy de propósito: nem anon nem authenticated leem esta
-- tabela direto (nem precisam — o balcão não usa token de sessão do
-- cliente pra nada). RLS habilitado + zero policies = ninguém enxerga uma
-- linha sequer por fora das funções SECURITY DEFINER abaixo.

-- Trigger: toda vez que uma sessão nasce (em qualquer um dos "insert into
-- sessoes" já espalhados pelas migrações anteriores — 008, 009, 013, 014,
-- 016 — e no abrir_sessao novo, abaixo), gera o token dela junto, sem
-- precisar tocar em nenhum desses pontos de inserção existentes.
create or replace function public._gerar_token_sessao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into sessao_tokens (sessao_id) values (new.id);
  return new;
end;
$$;

create trigger trg_sessao_token_novo
  after insert on sessoes
  for each row
  execute function public._gerar_token_sessao();

-- Backfill: sessões que já existiam antes desta migração (abertas ou não)
-- ainda não têm token — sem isso, uma mesa com sessão aberta NO MOMENTO do
-- deploy ficaria travada até fechar e reabrir. "on conflict do nothing" pra
-- rodar de novo com segurança se precisar.
insert into sessao_tokens (sessao_id)
select id from sessoes
on conflict (sessao_id) do nothing;

-- ========================================================================
-- FUNÇÃO PRIVADA: _sessao_aberta_por_token
-- ========================================================================
-- Núcleo compartilhado pelas RPCs abaixo: acha a sessão ABERTA daquela mesa
-- cujo token_sessao bate com o informado — ou null, se não achar (token
-- nulo, errado, de outra mesa, ou de uma sessão que já não está mais
-- 'aberta', não importa o motivo: manual, automático ou por expiração,
-- basta o status não ser mais 'aberta'). Não é concedida pra anon nem
-- authenticated de propósito, mesmo raciocínio/mesmo padrão de
-- _conta_da_mesa_dados em 009_fechamento_parcial.sql.

create or replace function public._sessao_aberta_por_token(p_mesa int, p_token_sessao text)
returns uuid
language sql
stable
set search_path = public
as $$
  select s.id
  from sessoes s
  join sessao_tokens t on t.sessao_id = s.id
  where t.token_sessao = p_token_sessao
    and s.mesa = p_mesa
    and s.status = 'aberta';
$$;

revoke all on function public._sessao_aberta_por_token(int, text) from public;

-- ========================================================================
-- RPC: sessao_atual (substitui a versão de 014_sessao_vinculada.sql)
-- ========================================================================
-- Muda de "returns uuid" pra "returns jsonb": além de dizer QUE existe uma
-- sessão aberta, agora entrega o token_sessao dela — é assim que um
-- celular novo (ou um F5 sem nada guardado) consegue "entrar na sessão
-- vigente" sem precisar de nenhum toque extra, contanto que já tenha
-- passado pela checagem do token DA MESA logo acima. "drop" necessário
-- porque o tipo de retorno mudou (create or replace não permite isso).

drop function if exists public.sessao_atual(int, text);

create or replace function public.sessao_atual(p_mesa int, p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_mesa       mesas;
  v_sessao_id  uuid;
  v_token      text;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar a mesa. Verifique o QR code da mesa.';
  end if;

  select s.id, t.token_sessao into v_sessao_id, v_token
  from sessoes s
  join sessao_tokens t on t.sessao_id = s.id
  where s.mesa = p_mesa and s.status = 'aberta'
  limit 1;

  if v_sessao_id is null then
    return null;
  end if;

  return jsonb_build_object('sessao_id', v_sessao_id, 'token_sessao', v_token);
end;
$$;

comment on function public.sessao_atual(int, text) is 'Sessão aberta atual da mesa: {sessao_id, token_sessao}, ou null se não houver nenhuma. Exige o token da mesa. NUNCA cria sessão — só lê. Usado pelo cardápio ao carregar a página pra decidir entre entrar direto ou mostrar "Iniciar novo pedido".';

revoke all on function public.sessao_atual(int, text) from public;
grant execute on function public.sessao_atual(int, text) to anon;

-- ========================================================================
-- RPC: abrir_sessao
-- ========================================================================
-- Único lugar que o CLIENTE pode acionar pra abrir uma sessão nova — só sob
-- toque explícito no botão "Iniciar novo pedido" (nunca automaticamente no
-- carregamento da página, ver js/script.js). Se, entre a checagem de
-- sessao_atual e o toque, alguém mais já tiver aberto uma sessão pra essa
-- mesa (ex.: dois amigos tocando quase ao mesmo tempo), o "on conflict" faz
-- os dois caírem na MESMA sessão em vez de abrir duas em paralelo — mesmo
-- comportamento de "entrar na sessão vigente" que sessao_atual já dá pra
-- quem chega depois.

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

comment on function public.abrir_sessao(int, text) is 'Abre uma sessão nova pra mesa (ou entrega o token da que já estiver aberta, se alguém abriu um instante antes) e devolve {sessao_id, token_sessao}. Único caminho de criação de sessão pro cliente — sempre sob toque explícito no botão "Iniciar novo pedido", nunca automático.';

revoke all on function public.abrir_sessao(int, text) from public;
grant execute on function public.abrir_sessao(int, text) to anon;

-- ========================================================================
-- RPC: criar_pedido (substitui a versão de 016_rate_limit_por_pessoa.sql)
-- ========================================================================
-- Troca p_session_id (uuid, opcional, com fallback que abria sessão sozinho)
-- por p_token_sessao (text, também default null mas SEMPRE exigido em
-- tempo de execução — ver o "if" logo no início do corpo). Sem fallback:
-- se não houver token_sessao válido, recusa com SESSAO_ENCERRADA e não
-- grava nada — abrir sessão deixou de ser responsabilidade desta função
-- (agora é só de abrir_sessao, acima). O resto (limites de frequência,
-- validação de itens, rateio de compartilhado) é idêntico a 016.

drop function if exists public.criar_pedido(int, text, jsonb, text, uuid, uuid);

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

  -- Token de SESSÃO (autorização de pedir nesta rodada — não confundir com
  -- o token DA MESA checado acima, que só identifica a mesa; ver comentário
  -- no topo deste arquivo). Checado logo após a mesa/token, antes de
  -- qualquer validação de negócio: sem sessão aberta válida, nada mais
  -- importa. Nunca abre sessão sozinho aqui — isso só acontece em
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

comment on function public.criar_pedido(int, text, jsonb, text, uuid, text) is 'Único caminho de escrita de pedidos pro cliente (anon). Exige token da mesa E p_token_sessao válido (sessão aberta daquela mesa) — sem fallback: nunca abre sessão sozinho (isso é só abrir_sessao). Limita frequência por pessoa e por mesa (ver 016_rate_limit_por_pessoa.sql).';

grant execute on function public.criar_pedido(int, text, jsonb, text, uuid, text) to anon;

-- ========================================================================
-- RPC: pedir_fechamento (substitui a versão de 014_sessao_vinculada.sql)
-- ========================================================================

drop function if exists public.pedir_fechamento(int, text, uuid);

create or replace function public.pedir_fechamento(p_mesa int, p_token text, p_token_sessao text default null)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa       mesas;
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

  v_sessao_id := public._sessao_aberta_por_token(p_mesa, p_token_sessao);
  if v_sessao_id is null then
    raise exception 'Esta conta foi encerrada.' using detail = 'SESSAO_ENCERRADA';
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

comment on function public.pedir_fechamento(int, text, text) is 'Registra o pedido de fechamento de conta da mesa. Exige token da mesa e p_token_sessao válido (sessão aberta daquela mesa) — senão recusa com SESSAO_ENCERRADA. Devolve o existente se já houver um pendente, em vez de duplicar o alerta no balcão.';

grant execute on function public.pedir_fechamento(int, text, text) to anon;

-- ========================================================================
-- RPC: conta_da_mesa (substitui a versão de 014_sessao_vinculada.sql)
-- ========================================================================

drop function if exists public.conta_da_mesa(int, text, uuid, uuid);

create or replace function public.conta_da_mesa(p_mesa int, p_token text, p_cliente_id uuid default null, p_token_sessao text default null)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_mesa      mesas;
  v_sessao_id uuid;
  v_resultado jsonb;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar sua conta. Verifique o QR code da mesa.';
  end if;

  v_sessao_id := public._sessao_aberta_por_token(p_mesa, p_token_sessao);
  if v_sessao_id is null then
    raise exception 'Esta conta foi encerrada.' using detail = 'SESSAO_ENCERRADA';
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

comment on function public.conta_da_mesa(int, text, uuid, text) is 'Itens, totais (geral/pago/aguardando/saldo) e resumo por pessoa da sessão aberta da mesa. Com p_cliente_id, inclui "minha_parte". Exige token da mesa e p_token_sessao válido — senão recusa com SESSAO_ENCERRADA.';

grant execute on function public.conta_da_mesa(int, text, uuid, text) to anon;
