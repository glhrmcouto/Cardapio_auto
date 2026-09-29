-- ========================================================================
-- AOOBA! BAR — rate limit de pedidos por PESSOA, não só por mesa
-- (migração 016)
-- Pré-requisito: 014_sessao_vinculada.sql (última versão de criar_pedido).
--
-- PROBLEMA: o limite de frequência criado em 005_seguranca.sql (Etapa 3) é
-- "no máximo 5 pedidos por MESA a cada 2 minutos" — fazia sentido quando
-- uma mesa = um pedido de cada vez, mas não bate com o modelo de sessão com
-- várias pessoas (008_sessoes.sql em diante): uma mesa de 6+ pessoas, cada
-- uma mandando o primeiro pedido dela quase ao mesmo tempo, já estoura os 5
-- e trava gente que nunca pediu nada ainda — o oposto de "limite anti-spam".
--
-- A PARTIR DAQUI, dois limites independentes dentro de criar_pedido:
--   - POR PESSOA (cliente_id): pega spam de UM aparelho/pessoa só. É o
--     limite que realmente importa pro abuso comum (alguém martelando o
--     botão "Fazer Pedido").
--   - POR MESA: continua existindo como rede de segurança contra abuso
--     DISTRIBUÍDO (várias identidades diferentes, mesmo que fake, mandando
--     pedido pra mesma mesa em sequência) — mas com um teto bem mais alto,
--     que não deveria nunca ser tocado por uma mesa cheia se comportando
--     normalmente.
--
-- Os dois números moram em constantes no topo do "declare" da função (ver
-- v_limite_pedidos_pessoa/v_limite_pedidos_mesa abaixo), fáceis de achar e
-- ajustar depois de ver o movimento real do bar.
-- ========================================================================

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
  -- ==== LIMITES DE FREQUÊNCIA — ajuste aqui, sem mexer no resto da função ====
  v_limite_pedidos_pessoa  constant int := 5;   -- por cliente_id, em 2 minutos
  v_limite_pedidos_mesa    constant int := 20;  -- por mesa (rede de segurança), em 2 minutos
  -- ============================================================================

  v_pedido                  pedidos;
  v_mesa                    mesas;
  v_sessao                  sessoes;
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
  -- porque é o caso comum; a mensagem é a mesma de antes desta migração,
  -- só que agora conta por cliente_id em vez de mesa.
  select count(*) into v_pedidos_recentes_pessoa
  from pedidos
  where cliente_id = p_cliente_id
    and tipo = 'pedido'
    and criado_em > now() - interval '2 minutes';

  if v_pedidos_recentes_pessoa >= v_limite_pedidos_pessoa then
    raise exception 'Aguarde um instante antes de fazer outro pedido.';
  end if;

  -- Limite POR MESA (rede de segurança, teto bem mais alto — ver comentário
  -- no topo do arquivo) — mensagem diferente de propósito, só pra dar pra
  -- diferenciar qual dos dois limites disparou ao testar; pro cliente, os
  -- dois textos continuam igualmente genéricos (não revelam número nem
  -- qual regra bateu).
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

  -- Limite de itens por pedido (inalterado — ver 005_seguranca.sql).
  if v_total_itens > 40 then
    raise exception 'Esse pedido tem itens demais (máximo de 40 por pedido). Divida em mais de um pedido.';
  end if;

  -- Vínculo de sessão (ver 014_sessao_vinculada.sql): session_id vindo do
  -- navegador precisa ser da sessão aberta ATUAL dessa mesa; se não for
  -- (sessão já encerrada, id de outra mesa, ou um id que não existe),
  -- recusa aqui, sem gravar pedido nenhum. Só quando o navegador ainda não
  -- tem session_id nenhum (primeiro pedido de um scan novo) é que o
  -- servidor localiza a sessão aberta da mesa ou abre uma nova.
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

comment on function public.criar_pedido(int, text, jsonb, text, uuid, uuid) is 'Único caminho de escrita de pedidos pro cliente (anon). Limita frequência por PESSOA (cliente_id, v_limite_pedidos_pessoa) e por MESA como rede de segurança (v_limite_pedidos_mesa) — ver 016_rate_limit_por_pessoa.sql. Exige que p_session_id (quando informado) seja da sessão aberta atual da mesa — senão recusa com SESSAO_ENCERRADA.';

-- Sem "drop"/"grant" aqui: mesma assinatura de 014_sessao_vinculada.sql, os
-- privilégios já concedidos lá continuam valendo.
