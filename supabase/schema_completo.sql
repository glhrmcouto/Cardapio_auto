-- ========================================================================
-- SCHEMA COMPLETO — instalação NOVA do banco, num passo só
-- ========================================================================
--
-- GERADO AUTOMATICAMENTE por supabase/ferramentas/gerar_schema_completo.mjs
-- a partir de 001_schema.sql .. 024_lancar_pedido_garcom.sql. Não edite à mão: mude/crie
-- uma migração e rode o gerador de novo.
--
-- Use SÓ num projeto Supabase vazio, no lugar de rodar as migrações uma a
-- uma — o resultado é o mesmo (o gerador confere isso). Num banco que já
-- está rodando, NÃO rode este arquivo: aplique só as migrações novas.
--
-- Depois de rodar: crie os usuários de login e o perfil de admin (ver
-- README, "Como configurar o Supabase do zero").
-- ========================================================================

set check_function_bodies = false;
set client_min_messages = warning;

create extension if not exists "pgcrypto";

--
-- Name: _bloquear_mesa(integer); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._bloquear_mesa(p_mesa integer) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update mesas set status_mesa = 'bloqueada' where numero = p_mesa;
$$;

--
-- Name: _conta_da_mesa_dados(uuid); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._conta_da_mesa_dados(p_sessao_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with itens_agg as (
    select pi.nome_snapshot, pi.preco_unitario, sum(pi.quantidade)::int as quantidade
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
    group by pi.nome_snapshot, pi.preco_unitario
  ),
  subtotal_calc as (
    select coalesce(sum(preco_unitario * quantidade), 0)::numeric(10, 2) as subtotal
    from itens_agg
  ),
  pagamentos_totais as (
    select
      coalesce(sum(valor_total) filter (where status = 'confirmado'), 0)::numeric(10, 2) as total_pago,
      coalesce(sum(valor_total) filter (where status = 'pendente'), 0)::numeric(10, 2) as total_pendente
    from pagamentos
    where sessao_id = p_sessao_id
  ),
  pessoas as (
    select distinct on (nome_norm) nome_norm, nome_exibicao
    from (
      select
        lower(trim(coalesce(cliente_nome, ''))) as nome_norm,
        coalesce(nullif(trim(cliente_nome), ''), 'Sem nome') as nome_exibicao,
        criado_em
      from pedidos
      where sessao_id = p_sessao_id and tipo = 'pedido'
    ) x
    order by nome_norm, criado_em desc
  ),
  aberto_direto as (
    select
      lower(trim(coalesce(p.cliente_nome, ''))) as nome_norm,
      coalesce(sum(pi.preco_unitario * pi.quantidade), 0) as valor
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
      and pi.compartilhado = false and pi.pagamento_id is null
    group by 1
  ),
  cliente_nomes as (
    select distinct on (cliente_id) cliente_id, lower(trim(coalesce(cliente_nome, ''))) as nome_norm
    from pedidos
    where sessao_id = p_sessao_id and tipo = 'pedido'
    order by cliente_id, criado_em desc
  ),
  aberto_rateio as (
    select cn.nome_norm, coalesce(sum(rc.valor), 0) as valor
    from rateio_compartilhado rc
    join pedido_itens pi on pi.id = rc.pedido_item_id
    join pedidos p on p.id = pi.pedido_id
    join cliente_nomes cn on cn.cliente_id = rc.cliente_id
    where p.sessao_id = p_sessao_id and rc.pagamento_id is null
    group by cn.nome_norm
  ),
  pagos_por_pessoa as (
    select
      lower(trim(nome)) as nome_norm,
      coalesce(sum(subtotal) filter (where status = 'confirmado'), 0) as subtotal_pago,
      coalesce(sum(taxa_servico) filter (where status = 'confirmado'), 0) as taxa_pago,
      coalesce(sum(subtotal) filter (where status = 'pendente'), 0) as subtotal_aguardando,
      coalesce(sum(taxa_servico) filter (where status = 'pendente'), 0) as taxa_aguardando
    from pagamentos
    where sessao_id = p_sessao_id
    group by 1
  ),
  por_pessoa_calc as (
    select
      pe.nome_exibicao as nome,
      coalesce(ad.valor, 0) + coalesce(ar.valor, 0) as subtotal_aberto,
      round((coalesce(ad.valor, 0) + coalesce(ar.valor, 0)) * public._taxa_servico_percentual() / 100, 2) as taxa_aberto,
      coalesce(pg.subtotal_aguardando, 0)::numeric(10, 2) as subtotal_aguardando,
      coalesce(pg.taxa_aguardando, 0)::numeric(10, 2) as taxa_aguardando,
      coalesce(pg.subtotal_pago, 0)::numeric(10, 2) as subtotal_pago,
      coalesce(pg.taxa_pago, 0)::numeric(10, 2) as taxa_pago
    from pessoas pe
    left join aberto_direto ad on ad.nome_norm = pe.nome_norm
    left join aberto_rateio ar on ar.nome_norm = pe.nome_norm
    left join pagos_por_pessoa pg on pg.nome_norm = pe.nome_norm
  )
  select jsonb_build_object(
    'itens', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'preco', preco_unitario, 'quantidade', quantidade)
         order by nome_snapshot
       )
       from itens_agg),
      '[]'::jsonb
    ),
    'subtotal', (select subtotal from subtotal_calc),
    'taxa_servico', round((select subtotal from subtotal_calc) * public._taxa_servico_percentual() / 100, 2),
    'total_geral', (select subtotal from subtotal_calc) + round((select subtotal from subtotal_calc) * public._taxa_servico_percentual() / 100, 2),
    'taxa_servico_percentual', public._taxa_servico_percentual(),
    'total_pago', (select total_pago from pagamentos_totais),
    'total_pendente_confirmacao', (select total_pendente from pagamentos_totais),
    'saldo_restante', greatest(
      (select subtotal from subtotal_calc) + round((select subtotal from subtotal_calc) * public._taxa_servico_percentual() / 100, 2)
        - (select total_pago from pagamentos_totais) - (select total_pendente from pagamentos_totais),
      0
    ),
    'por_pessoa', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'nome', nome,
           'status', case
             when subtotal_aberto > 0 then 'em_aberto'
             when (subtotal_aguardando + taxa_aguardando) > 0 then 'aguardando'
             else 'pago'
           end,
           'subtotal', case
             when subtotal_aberto > 0 then subtotal_aberto
             when (subtotal_aguardando + taxa_aguardando) > 0 then subtotal_aguardando
             else subtotal_pago
           end,
           'taxa_servico', case
             when subtotal_aberto > 0 then taxa_aberto
             when (subtotal_aguardando + taxa_aguardando) > 0 then taxa_aguardando
             else taxa_pago
           end,
           'valor', case
             when subtotal_aberto > 0 then subtotal_aberto + taxa_aberto
             when (subtotal_aguardando + taxa_aguardando) > 0 then subtotal_aguardando + taxa_aguardando
             else subtotal_pago + taxa_pago
           end
         )
         order by nome
       )
       from por_pessoa_calc),
      '[]'::jsonb
    )
  );
$$;

--
-- Name: _exigir_admin(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._exigir_admin() RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_admin() then
    raise exception 'Acesso restrito a administradores.' using errcode = '42501';
  end if;
end;
$$;

--
-- Name: FUNCTION _exigir_admin(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public._exigir_admin() IS 'Barra a execução com exceção se o usuário logado não tiver papel admin. Usada só internamente pelas funções de relatório.';

--
-- Name: _exigir_garcom(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._exigir_garcom() RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_garcom() then
    raise exception 'Acesso restrito ao papel garçom.' using errcode = '42501';
  end if;
end;
$$;

--
-- Name: FUNCTION _exigir_garcom(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public._exigir_garcom() IS 'Barra a execução com exceção se o usuário logado não tiver papel garcom (nem balcao nem admin passam aqui). Usada só internamente por lancar_pedido_garcom.';

--
-- Name: _exigir_garcom_ou_balcao(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._exigir_garcom_ou_balcao() RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_garcom_ou_balcao() then
    raise exception 'Acesso restrito a garçom, balcão ou administrador.' using errcode = '42501';
  end if;
end;
$$;

--
-- Name: FUNCTION _exigir_garcom_ou_balcao(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public._exigir_garcom_ou_balcao() IS 'Barra a execução com exceção se o usuário logado não tiver papel garcom/balcao/admin em "perfis". Usada internamente por futuras RPCs que precisem restringir a quem opera o salão.';

--
-- Name: _gerar_token_sessao(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._gerar_token_sessao() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  insert into sessao_tokens (sessao_id) values (new.id);
  return new;
end;
$$;

--
-- Name: _minha_parte_dados(uuid, uuid); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._minha_parte_dados(p_sessao_id uuid, p_cliente_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with meu_nome as (
    select public._nome_norm_do_cliente(p_sessao_id, p_cliente_id) as nome_norm
  ),
  itens_diretos as (
    select pi.nome_snapshot, pi.preco_unitario, pi.quantidade, (pi.pagamento_id is not null) as pago
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
      and lower(trim(coalesce(p.cliente_nome, ''))) = (select nome_norm from meu_nome)
      and pi.compartilhado = false
  ),
  itens_compartilhados as (
    select pi.nome_snapshot, rc.valor, (rc.pagamento_id is not null) as pago
    from rateio_compartilhado rc
    join pedido_itens pi on pi.id = rc.pedido_item_id
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = p_sessao_id and p.tipo = 'pedido'
      and exists (
        select 1 from pedidos p2
        where p2.cliente_id = rc.cliente_id and p2.sessao_id = p_sessao_id and p2.tipo = 'pedido'
          and lower(trim(coalesce(p2.cliente_nome, ''))) = (select nome_norm from meu_nome)
      )
  ),
  subtotal_aberto_calc as (
    select
      coalesce((select sum(preco_unitario * quantidade) from itens_diretos where not pago), 0)
      + coalesce((select sum(valor) from itens_compartilhados where not pago), 0) as subtotal
  ),
  pagamentos_pessoa as (
    select
      coalesce(sum(subtotal) filter (where status = 'confirmado'), 0)::numeric(10, 2) as subtotal_pago,
      coalesce(sum(taxa_servico) filter (where status = 'confirmado'), 0)::numeric(10, 2) as taxa_pago,
      coalesce(sum(subtotal) filter (where status = 'pendente'), 0)::numeric(10, 2) as subtotal_aguardando,
      coalesce(sum(taxa_servico) filter (where status = 'pendente'), 0)::numeric(10, 2) as taxa_aguardando
    from pagamentos
    where sessao_id = p_sessao_id
      and lower(trim(nome)) = (select nome_norm from meu_nome)
  )
  select jsonb_build_object(
    'itens_diretos', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'preco', preco_unitario, 'quantidade', quantidade, 'pago', pago)
         order by nome_snapshot
       )
       from itens_diretos),
      '[]'::jsonb
    ),
    'itens_compartilhados', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'valor', valor, 'pago', pago)
         order by nome_snapshot
       )
       from itens_compartilhados),
      '[]'::jsonb
    ),
    'subtotal_em_aberto', (select subtotal from subtotal_aberto_calc),
    'subtotal_aguardando', (select subtotal_aguardando from pagamentos_pessoa),
    'taxa_aguardando', (select taxa_aguardando from pagamentos_pessoa),
    'total_aguardando', (select subtotal_aguardando + taxa_aguardando from pagamentos_pessoa),
    'subtotal_pago', (select subtotal_pago from pagamentos_pessoa),
    'taxa_pago', (select taxa_pago from pagamentos_pessoa),
    'total_pago', (select subtotal_pago + taxa_pago from pagamentos_pessoa),
    'status', case
      when (select subtotal from subtotal_aberto_calc) > 0 then 'em_aberto'
      when (select subtotal_aguardando + taxa_aguardando from pagamentos_pessoa) > 0 then 'aguardando'
      else 'pago'
    end
  );
$$;

--
-- Name: _nome_norm_do_cliente(uuid, uuid); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._nome_norm_do_cliente(p_sessao_id uuid, p_cliente_id uuid) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select lower(trim(coalesce(cliente_nome, '')))
  from pedidos
  where sessao_id = p_sessao_id and tipo = 'pedido' and cliente_id = p_cliente_id
  order by criado_em desc
  limit 1;
$$;

--
-- Name: _sessao_aberta_por_token(integer, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._sessao_aberta_por_token(p_mesa integer, p_token_sessao text) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select s.id
  from sessoes s
  join sessao_tokens t on t.sessao_id = s.id
  where t.token_sessao = p_token_sessao
    and s.mesa = p_mesa
    and s.status = 'aberta';
$$;

--
-- Name: _taxa_servico_percentual(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public._taxa_servico_percentual() RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce((select valor::numeric from configuracoes where chave = 'taxa_servico_percentual'), 0);
$$;

--
-- Name: FUNCTION _taxa_servico_percentual(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public._taxa_servico_percentual() IS 'Percentual atual da taxa de serviço (0 = desativada). Editável em configuracoes pelo admin.html. Uso interno das RPCs de pedido/fechamento — não precisa de grant explícito, mesmo raciocínio de _exigir_admin() em 004_relatorios.sql.';

--
-- Name: abrir_sessao(integer, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.abrir_sessao(p_mesa integer, p_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION abrir_sessao(p_mesa integer, p_token text); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.abrir_sessao(p_mesa integer, p_token text) IS 'Abre uma sessão nova pra mesa (ou entrega o token da que já estiver aberta) e devolve {sessao_id, token_sessao}. Recusa com MESA_BLOQUEADA se status_mesa=''bloqueada'' (ver 019_bloqueio_mesa.sql). Único caminho de criação de sessão pro cliente, sempre sob toque explícito.';

--
-- Name: ativar_mesa(integer); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.ativar_mesa(p_mesa integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  update mesas set ativa = true where numero = p_mesa;

  if not found then
    raise exception 'Mesa % não encontrada.', p_mesa;
  end if;
end;
$$;

--
-- Name: FUNCTION ativar_mesa(p_mesa integer); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.ativar_mesa(p_mesa integer) IS 'Reativa uma mesa (ativa=true), devolvendo-a pro cardápio do cliente — mesmo efeito de ativar em admin.html, só que chamável direto do balcão. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

--
-- Name: bloquear_todas_mesas(boolean); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.bloquear_todas_mesas(p_forcar boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_bloqueadas int;
  v_puladas    int;
begin
  if p_forcar then
    update mesas
    set status_mesa = 'bloqueada'
    where ativa = true
      and status_mesa <> 'bloqueada';

    get diagnostics v_bloqueadas = row_count;
    v_puladas := 0;
  else
    update mesas m
    set status_mesa = 'bloqueada'
    where m.ativa = true
      and m.status_mesa <> 'bloqueada'
      and not exists (
        select 1 from sessoes s where s.mesa = m.numero and s.status = 'aberta'
      );

    get diagnostics v_bloqueadas = row_count;

    select count(*) into v_puladas
    from mesas m
    where m.ativa = true
      and m.status_mesa <> 'bloqueada'
      and exists (
        select 1 from sessoes s where s.mesa = m.numero and s.status = 'aberta'
      );
  end if;

  return jsonb_build_object('bloqueadas', v_bloqueadas, 'puladas', v_puladas);
end;
$$;

--
-- Name: FUNCTION bloquear_todas_mesas(p_forcar boolean); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.bloquear_todas_mesas(p_forcar boolean) IS 'Bloqueia (status_mesa=''bloqueada'') toda mesa ativa de uma vez — uso típico: fechar a casa. Por padrão PULA mesa com sessão aberta (conta em andamento) e devolve {bloqueadas, puladas}; com p_forcar=true bloqueia mesmo as com sessão aberta (puladas sempre 0 nesse caso). Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

--
-- Name: confirmar_pagamento(uuid); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.confirmar_pagamento(p_pagamento_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION confirmar_pagamento(p_pagamento_id uuid); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.confirmar_pagamento(p_pagamento_id uuid) IS 'Marca um pagamento pendente como confirmado e, se foi a última pendência da sessão, encerra a sessão E bloqueia a mesa (status_mesa=''bloqueada'', ver 019_bloqueio_mesa.sql) automaticamente. Retorna {pagamento, sessao_encerrada, mesa}. Restrito a authenticated.';

--
-- Name: conta_da_mesa(integer, text, uuid, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.conta_da_mesa(p_mesa integer, p_token text, p_cliente_id uuid DEFAULT NULL::uuid, p_token_sessao text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION conta_da_mesa(p_mesa integer, p_token text, p_cliente_id uuid, p_token_sessao text); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.conta_da_mesa(p_mesa integer, p_token text, p_cliente_id uuid, p_token_sessao text) IS 'Itens, totais (geral/pago/aguardando/saldo) e resumo por pessoa da sessão aberta da mesa. Com p_cliente_id, inclui "minha_parte". Exige token da mesa e p_token_sessao válido — senão recusa com SESSAO_ENCERRADA.';

--
-- Name: conta_da_mesa_balcao(integer); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.conta_da_mesa_balcao(p_mesa integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_sessao_id uuid;
begin
  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta';
  return public._conta_da_mesa_dados(v_sessao_id);
end;
$$;

--
-- Name: FUNCTION conta_da_mesa_balcao(p_mesa integer); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.conta_da_mesa_balcao(p_mesa integer) IS 'Itens, totais (geral/pago/aguardando/saldo) e resumo por pessoa da sessão aberta da mesa. Uso interno do balcão — sem token, qualquer authenticated pode chamar.';

--
-- Name: pedidos; Type: TABLE; Schema: public
--

CREATE TABLE public.pedidos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo text NOT NULL,
    mesa integer NOT NULL,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    sessao_id uuid,
    cliente_nome text,
    cliente_id uuid,
    origem text DEFAULT 'cliente'::text NOT NULL,
    CONSTRAINT pedidos_mesa_check CHECK ((mesa > 0)),
    CONSTRAINT pedidos_origem_check CHECK ((origem = ANY (ARRAY['cliente'::text, 'garcom'::text]))),
    CONSTRAINT pedidos_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'entregue'::text, 'finalizado'::text]))),
    CONSTRAINT pedidos_tipo_check CHECK ((tipo = ANY (ARRAY['pedido'::text, 'fechar_conta'::text]))),
    CONSTRAINT pedidos_total_check CHECK ((total >= (0)::numeric))
);

--
-- Name: TABLE pedidos; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.pedidos IS 'Pedidos e solicitações de fechamento de conta. Gravado somente via RPC (criar_pedido / pedir_fechamento).';

--
-- Name: COLUMN pedidos.sessao_id; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedidos.sessao_id IS 'Sessão (rodada de clientes) à qual este pedido pertence. É isso, não mais o status, que separa a conta do grupo atual da de um grupo anterior na mesma mesa.';

--
-- Name: COLUMN pedidos.cliente_nome; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedidos.cliente_nome IS 'Nome/apelido (máx. 20 caracteres) que a pessoa informou no cardápio antes de pedir. Nulo em pedidos anteriores a esta migração.';

--
-- Name: COLUMN pedidos.cliente_id; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedidos.cliente_id IS 'uuid gerado no navegador da pessoa (sessionStorage), reaproveitado em todos os pedidos dela na mesma visita — é o que permite agrupar "pedidos da Maria" dentro da sessão da mesa pro rateio por pessoa.';

--
-- Name: COLUMN pedidos.origem; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedidos.origem IS '"cliente": feito pelo próprio cliente via QR code (criar_pedido). "garcom": lançado pelo garçom sem QR, pra cliente sem celular (ver lancar_pedido_garcom, 024).';

--
-- Name: criar_pedido(integer, text, jsonb, text, uuid, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.criar_pedido(p_mesa integer, p_token text, p_itens jsonb, p_cliente_nome text, p_cliente_id uuid, p_token_sessao text DEFAULT NULL::text) RETURNS public.pedidos
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION criar_pedido(p_mesa integer, p_token text, p_itens jsonb, p_cliente_nome text, p_cliente_id uuid, p_token_sessao text); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.criar_pedido(p_mesa integer, p_token text, p_itens jsonb, p_cliente_nome text, p_cliente_id uuid, p_token_sessao text) IS 'Único caminho de escrita de pedidos pro cliente (anon). Recusa com MESA_BLOQUEADA se status_mesa=''bloqueada'' (ver 019_bloqueio_mesa.sql), com SESSAO_ENCERRADA sem token_sessao válido. Limita frequência por pessoa e por mesa.';

--
-- Name: desativar_mesa(integer); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.desativar_mesa(p_mesa integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  update mesas set ativa = false where numero = p_mesa;

  if not found then
    raise exception 'Mesa % não encontrada.', p_mesa;
  end if;
end;
$$;

--
-- Name: FUNCTION desativar_mesa(p_mesa integer); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.desativar_mesa(p_mesa integer) IS 'Desativa uma mesa (ativa=false), tirando-a de circulação pro cliente — mesmo efeito de desativar em admin.html, só que chamável direto do balcão. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

--
-- Name: detalhe_pagamento(uuid); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.detalhe_pagamento(p_pagamento_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'itens_diretos', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', pi.nome_snapshot, 'preco', pi.preco_unitario, 'quantidade', pi.quantidade)
         order by pi.nome_snapshot
       )
       from pedido_itens pi
       where pi.pagamento_id = p_pagamento_id),
      '[]'::jsonb
    ),
    'itens_compartilhados', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', pi.nome_snapshot, 'valor', rc.valor)
         order by pi.nome_snapshot
       )
       from rateio_compartilhado rc
       join pedido_itens pi on pi.id = rc.pedido_item_id
       where rc.pagamento_id = p_pagamento_id),
      '[]'::jsonb
    )
  );
$$;

--
-- Name: FUNCTION detalhe_pagamento(p_pagamento_id uuid); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.detalhe_pagamento(p_pagamento_id uuid) IS 'Itens diretos e fatias de compartilhados cobertos por um pagamento específico. Uso interno do balcão, pro card de alerta de fechamento parcial.';

--
-- Name: eh_admin(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.eh_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from perfis
    where user_id = auth.uid() and papel = 'admin'
  );
$$;

--
-- Name: FUNCTION eh_admin(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.eh_admin() IS 'true se o usuário logado tem papel admin em "perfis". Usado nas policies de escrita de produtos.';

--
-- Name: eh_garcom(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.eh_garcom() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from perfis
    where user_id = auth.uid() and papel = 'garcom'
  );
$$;

--
-- Name: FUNCTION eh_garcom(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.eh_garcom() IS 'true se o usuário logado tem papel garcom (só garcom — nem balcao nem admin) em "perfis". Usado por lancar_pedido_garcom.';

--
-- Name: eh_garcom_ou_balcao(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.eh_garcom_ou_balcao() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from perfis
    where user_id = auth.uid() and papel in ('garcom', 'balcao', 'admin')
  );
$$;

--
-- Name: FUNCTION eh_garcom_ou_balcao(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.eh_garcom_ou_balcao() IS 'true se o usuário logado tem papel garcom, balcao ou admin em "perfis". Usado por garcom.html (client-side, mesmo padrão de eh_admin() em admin.js) e por qualquer RPC futura que precise da mesma checagem.';

--
-- Name: encerrar_sessao(integer, boolean); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.encerrar_sessao(p_mesa integer, p_forcar boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

--
-- Name: FUNCTION encerrar_sessao(p_mesa integer, p_forcar boolean); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.encerrar_sessao(p_mesa integer, p_forcar boolean) IS 'Fecha a sessão aberta da mesa e BLOQUEIA a mesa (status_mesa=''bloqueada'', ver 019_bloqueio_mesa.sql) até liberar_mesa. Recusa com CONTA_JA_ENCERRADA se não houver sessão aberta. Recusa por saldo se existir alguém em_aberto, a menos que p_forcar=true. Restrito a authenticated.';

--
-- Name: faturamento_por_dia(date, date); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.faturamento_por_dia(p_data_inicio date, p_data_fim date) RETURNS TABLE(dia date, faturamento numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION faturamento_por_dia(p_data_inicio date, p_data_fim date); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.faturamento_por_dia(p_data_inicio date, p_data_fim date) IS 'Faturamento (soma de pedidos.total) por dia civil no período, só pedidos tipo=pedido. Restrito a admin.';

--
-- Name: pagamentos; Type: TABLE; Schema: public
--

CREATE TABLE public.pagamentos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sessao_id uuid NOT NULL,
    cliente_id uuid NOT NULL,
    nome text NOT NULL,
    valor_total numeric(10,2) CONSTRAINT pagamentos_valor_not_null NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    confirmado_em timestamp with time zone,
    subtotal numeric(10,2) NOT NULL,
    taxa_servico numeric(10,2) NOT NULL,
    taxa_aceita boolean DEFAULT true NOT NULL,
    CONSTRAINT pagamentos_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'confirmado'::text]))),
    CONSTRAINT pagamentos_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT pagamentos_taxa_servico_check CHECK ((taxa_servico >= (0)::numeric)),
    CONSTRAINT pagamentos_valor_check CHECK ((valor_total >= (0)::numeric))
);

--
-- Name: TABLE pagamentos; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.pagamentos IS 'Um registro por "fechei a minha parte": valor já congelado (subtotal da pessoa + taxa de serviço) no momento da criação. status=pendente até o garçom confirmar que recebeu (ver confirmar_pagamento).';

--
-- Name: COLUMN pagamentos.valor_total; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pagamentos.valor_total IS 'subtotal + taxa_servico — o que de fato é cobrado dessa pessoa.';

--
-- Name: COLUMN pagamentos.subtotal; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pagamentos.subtotal IS 'Soma dos itens (diretos + fatias de compartilhados) dessa pessoa, sem taxa.';

--
-- Name: COLUMN pagamentos.taxa_servico; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pagamentos.taxa_servico IS 'Taxa de serviço já congelada (0 se a pessoa recusou — ver taxa_aceita).';

--
-- Name: COLUMN pagamentos.taxa_aceita; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pagamentos.taxa_aceita IS 'false quando a pessoa desmarcou "incluir taxa de serviço" ao fechar a parte dela.';

--
-- Name: fechar_parcial(integer, text, uuid, boolean); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.fechar_parcial(p_mesa integer, p_token text, p_cliente_id uuid, p_aceita_taxa boolean DEFAULT true) RETURNS public.pagamentos
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_mesa          mesas;
  v_sessao_id     uuid;
  v_nome          text;
  v_nome_norm     text;
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

  v_nome_norm := lower(trim(v_nome));

  -- Trava por mesa+NOME (não mais só cliente_id): junta automaticamente
  -- pedidos feitos com cliente_id diferentes desde que o nome bata, e evita
  -- duas chamadas em paralelo (clique duplo, ou duas "metades" da mesma
  -- pessoa fechando ao mesmo tempo) duplicarem o pagamento.
  perform pg_advisory_xact_lock(hashtext('fechar_parcial:' || p_mesa::text), hashtext(v_nome_norm));

  select coalesce(sum(pi.preco_unitario * pi.quantidade), 0) into v_valor_direto
  from pedido_itens pi
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and p.tipo = 'pedido'
    and lower(trim(coalesce(p.cliente_nome, ''))) = v_nome_norm
    and pi.compartilhado = false and pi.pagamento_id is null;

  select coalesce(sum(rc.valor), 0) into v_valor_rateio
  from rateio_compartilhado rc
  join pedido_itens pi on pi.id = rc.pedido_item_id
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and rc.pagamento_id is null
    and exists (
      select 1 from pedidos p2
      where p2.cliente_id = rc.cliente_id and p2.sessao_id = v_sessao_id and p2.tipo = 'pedido'
        and lower(trim(coalesce(p2.cliente_nome, ''))) = v_nome_norm
    );

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
    and p.sessao_id = v_sessao_id and p.tipo = 'pedido'
    and lower(trim(coalesce(p.cliente_nome, ''))) = v_nome_norm
    and pi.compartilhado = false and pi.pagamento_id is null;

  update rateio_compartilhado rc
  set pagamento_id = v_pagamento.id
  where rc.pagamento_id is null
    and exists (
      select 1
      from pedido_itens pi
      join pedidos p on p.id = pi.pedido_id
      where pi.id = rc.pedido_item_id and p.sessao_id = v_sessao_id
    )
    and exists (
      select 1 from pedidos p2
      where p2.cliente_id = rc.cliente_id and p2.sessao_id = v_sessao_id and p2.tipo = 'pedido'
        and lower(trim(coalesce(p2.cliente_nome, ''))) = v_nome_norm
    );

  return v_pagamento;
end;
$$;

--
-- Name: FUNCTION fechar_parcial(p_mesa integer, p_token text, p_cliente_id uuid, p_aceita_taxa boolean); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.fechar_parcial(p_mesa integer, p_token text, p_cliente_id uuid, p_aceita_taxa boolean) IS 'Fecha a parte de uma pessoa (identificada pelo NOME normalizado, agregando todo cliente_id que já usou esse nome na sessão): congela subtotal, taxa e total num pagamento pendente e vincula os itens/rateios a ele.';

--
-- Name: lancar_pedido_garcom(integer, jsonb, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.lancar_pedido_garcom(p_mesa integer, p_itens jsonb, p_cliente_nome text DEFAULT NULL::text) RETURNS public.pedidos
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_pedido                pedidos;
  v_mesa                   mesas;
  v_sessao_id              uuid;
  v_pedidos_recentes_mesa  int;
  v_total                  numeric(10, 2) := 0;
  v_total_itens            int := 0;
  v_item                   jsonb;
  v_produto                produtos;
  v_quantidade             int;
  v_nome_limpo             text;
begin
  perform public._exigir_garcom();

  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found then
    raise exception 'Mesa % não encontrada ou inativa.', p_mesa;
  end if;

  if v_mesa.status_mesa = 'bloqueada' then
    raise exception 'Mesa aguardando liberação — libere a mesa antes de lançar o pedido.' using detail = 'MESA_BLOQUEADA';
  end if;

  -- Sem nome informado, assume "Garçom" (nunca fica em branco: cliente_nome
  -- aparece igual na fila do balcão/garçom pros pedidos do cliente).
  v_nome_limpo := nullif(trim(coalesce(p_cliente_nome, '')), '');
  if v_nome_limpo is null then
    v_nome_limpo := 'Garçom';
  end if;
  if length(v_nome_limpo) > 20 then
    raise exception 'Nome muito longo (máximo de 20 caracteres).';
  end if;

  -- Rede de segurança por mesa (mesmo teto de criar_pedido) — evita um
  -- clique duplicado/erro de app lançando pedidos repetidos sem querer.
  -- Sem limite por pessoa aqui: não existe "aparelho do cliente" pra
  -- identificar, cada chamada já é uma ação humana explícita do garçom.
  select count(*) into v_pedidos_recentes_mesa
  from pedidos
  where mesa = p_mesa and tipo = 'pedido' and criado_em > now() - interval '2 minutes';

  if v_pedidos_recentes_mesa >= 20 then
    raise exception 'Muitos pedidos nessa mesa em pouco tempo. Aguarde um instante e tente de novo.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  -- 1ª passada: valida TODOS os itens e calcula o total antes de gravar
  -- qualquer coisa — preço sempre lido de produtos.preco, nunca do jsonb
  -- recebido.
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

  -- Sessão aberta da mesa: reaproveita se já existir (ex.: cliente já
  -- pediu por celular nessa mesa), senão abre uma nova — mesmo "on
  -- conflict" de criar_pedido, mira o índice único parcial
  -- idx_sessoes_mesa_aberta_unica.
  insert into sessoes (mesa) values (p_mesa)
  on conflict (mesa) where status = 'aberta' do nothing;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;

  -- cliente_id novo a cada chamada (gen_random_uuid()): não existe um
  -- "aparelho do cliente" persistente aqui pra reaproveitar — cada pedido
  -- lançado pelo garçom é tratado como uma pessoa própria pro rateio de
  -- item compartilhado (sem efeito prático, já que esta RPC não lança
  -- item compartilhado — ver 2ª passada abaixo).
  insert into pedidos (tipo, mesa, total, status, sessao_id, cliente_nome, cliente_id, origem)
  values ('pedido', p_mesa, v_total, 'pendente', v_sessao_id, v_nome_limpo, gen_random_uuid(), 'garcom')
  returning * into v_pedido;

  -- 2ª passada: grava os itens, já sabendo que todos são válidos. Sem
  -- suporte a "compartilhado" aqui de propósito — rateio entre pessoas na
  -- mesma mesa não faz sentido pro fluxo do garçom (ele lança o pedido de
  -- UMA vez, não item por item ao longo da noite feito por pessoas
  -- diferentes); fica sempre false.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_quantidade := (v_item ->> 'quantidade')::int;

    select * into v_produto
    from produtos
    where id = (v_item ->> 'produto_id')::bigint;

    insert into pedido_itens (pedido_id, produto_id, nome_snapshot, preco_unitario, quantidade, compartilhado)
    values (v_pedido.id, v_produto.id, v_produto.nome, v_produto.preco, v_quantidade, false);
  end loop;

  return v_pedido;
end;
$$;

--
-- Name: FUNCTION lancar_pedido_garcom(p_mesa integer, p_itens jsonb, p_cliente_nome text); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.lancar_pedido_garcom(p_mesa integer, p_itens jsonb, p_cliente_nome text) IS 'Lança um pedido numa mesa sem precisar do token de QR — pro garçom atender cliente sem celular. Restrito ao papel garcom (_exigir_garcom, nem balcao nem admin). Recusa com MESA_BLOQUEADA se a mesa estiver bloqueada (a tela deve chamar liberar_mesa antes). Preço sempre recalculado a partir de produtos.preco.';

--
-- Name: liberar_mesa(integer); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.liberar_mesa(p_mesa integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION liberar_mesa(p_mesa integer); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.liberar_mesa(p_mesa integer) IS 'Libera uma mesa bloqueada (status_mesa=''liberada''), permitindo abrir sessão/pedido nela de novo. Único caminho de desbloqueio — sempre sob toque explícito do garçom no balcão. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de encerrar_sessao).';

--
-- Name: liberar_todas_mesas(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.liberar_todas_mesas() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_liberadas int;
begin
  update mesas
  set status_mesa = 'liberada'
  where ativa = true
    and status_mesa <> 'liberada';

  get diagnostics v_liberadas = row_count;

  return v_liberadas;
end;
$$;

--
-- Name: FUNCTION liberar_todas_mesas(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.liberar_todas_mesas() IS 'Libera (status_mesa=''liberada'') todas as mesas ativas de uma vez — uso típico: abertura do salão, depois de 021_mesa_inicia_bloqueada.sql fazer toda mesa nascer bloqueada. Retorna quantas mesas foram liberadas. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

--
-- Name: listar_mesas_balcao(); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.listar_mesas_balcao() RETURNS TABLE(numero integer, status_mesa text, ativa boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select numero, status_mesa, ativa
  from mesas
  order by numero;
$$;

--
-- Name: FUNCTION listar_mesas_balcao(); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.listar_mesas_balcao() IS 'Lista número/status_mesa/ativa de todas as mesas pro painel "Controle de Mesas" do balcão — nunca o token. Restrito a authenticated.';

--
-- Name: movimento_por_hora(date, date); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.movimento_por_hora(p_data_inicio date, p_data_fim date) RETURNS TABLE(hora integer, pedidos bigint, receita numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION movimento_por_hora(p_data_inicio date, p_data_fim date); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.movimento_por_hora(p_data_inicio date, p_data_fim date) IS 'Número de pedidos e receita por hora do dia (0-23, fuso America/Sao_Paulo), somado no período inteiro — mostra o horário de pico. Restrito a admin.';

--
-- Name: pedir_fechamento(integer, text, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.pedir_fechamento(p_mesa integer, p_token text, p_token_sessao text DEFAULT NULL::text) RETURNS public.pedidos
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION pedir_fechamento(p_mesa integer, p_token text, p_token_sessao text); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.pedir_fechamento(p_mesa integer, p_token text, p_token_sessao text) IS 'Registra o pedido de fechamento de conta da mesa. Exige token da mesa e p_token_sessao válido (sessão aberta daquela mesa) — senão recusa com SESSAO_ENCERRADA. Devolve o existente se já houver um pendente, em vez de duplicar o alerta no balcão.';

--
-- Name: produtos_mais_vendidos(date, date, integer); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.produtos_mais_vendidos(p_data_inicio date, p_data_fim date, p_limite integer DEFAULT 10) RETURNS TABLE(nome text, quantidade bigint, receita numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION produtos_mais_vendidos(p_data_inicio date, p_data_fim date, p_limite integer); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.produtos_mais_vendidos(p_data_inicio date, p_data_fim date, p_limite integer) IS 'Produtos mais vendidos no período (quantidade e receita), ordenado por quantidade desc. Restrito a admin.';

--
-- Name: mesas; Type: TABLE; Schema: public
--

CREATE TABLE public.mesas (
    numero integer NOT NULL,
    token text DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text) NOT NULL,
    ativa boolean DEFAULT true NOT NULL,
    status_mesa text DEFAULT 'bloqueada'::text NOT NULL,
    CONSTRAINT mesas_numero_check CHECK ((numero > 0)),
    CONSTRAINT mesas_status_mesa_check CHECK ((status_mesa = ANY (ARRAY['liberada'::text, 'bloqueada'::text])))
);

--
-- Name: TABLE mesas; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.mesas IS 'Uma linha por mesa física. O token é o segredo que vai no QR code (?mesa=N&t=TOKEN) e autoriza criar_pedido/pedir_fechamento pra essa mesa.';

--
-- Name: COLUMN mesas.status_mesa; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.mesas.status_mesa IS 'Se a mesa aceita abrir sessão/pedido AGORA. Nasce ''bloqueada'' (ver 021_mesa_inicia_bloqueada.sql) e também fica ''bloqueada'' depois de um fechamento total, até um garçom confirmar presença e liberar de novo (ver liberar_mesa). Independente de "ativa" (mesa existir no sistema).';

--
-- Name: regenerar_token_mesa(integer); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.regenerar_token_mesa(p_numero integer) RETURNS public.mesas
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_mesa mesas;
begin
  perform public._exigir_admin();

  update mesas
  set token = encode(gen_random_bytes(16), 'hex')
  where numero = p_numero
  returning * into v_mesa;

  if not found then
    raise exception 'Mesa % não encontrada.', p_numero;
  end if;

  return v_mesa;
end;
$$;

--
-- Name: FUNCTION regenerar_token_mesa(p_numero integer); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.regenerar_token_mesa(p_numero integer) IS 'Gera um token novo pra mesa (invalida o QR code antigo). Restrito a admin.';

--
-- Name: remover_item_pedido(uuid, bigint); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.remover_item_pedido(p_pedido_id uuid, p_item_id bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

--
-- Name: FUNCTION remover_item_pedido(p_pedido_id uuid, p_item_id bigint); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.remover_item_pedido(p_pedido_id uuid, p_item_id bigint) IS 'Remove um item de um pedido ainda pendente (cliente pediu errado) e recalcula o total; se era o último item, remove o pedido inteiro. Restrito a authenticated (tela do balcão).';

--
-- Name: sessao_atual(integer, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.sessao_atual(p_mesa integer, p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION sessao_atual(p_mesa integer, p_token text); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.sessao_atual(p_mesa integer, p_token text) IS 'Sessão aberta atual da mesa: {sessao_id, token_sessao}, ou null se não houver nenhuma. Exige o token da mesa. NUNCA cria sessão — só lê. Usado pelo cardápio ao carregar a página pra decidir entre entrar direto ou mostrar "Iniciar novo pedido".';

--
-- Name: status_da_mesa(integer, text); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.status_da_mesa(p_mesa integer, p_token text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION status_da_mesa(p_mesa integer, p_token text); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.status_da_mesa(p_mesa integer, p_token text) IS 'Devolve status_mesa (liberada/bloqueada) da mesa, exigindo o token da mesa. Usado pelo cliente pra decidir a tela quando não há sessão aberta.';

--
-- Name: ticket_medio_por_mesa(date, date); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.ticket_medio_por_mesa(p_data_inicio date, p_data_fim date) RETURNS TABLE(mesa integer, pedidos bigint, ticket_medio numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION ticket_medio_por_mesa(p_data_inicio date, p_data_fim date); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.ticket_medio_por_mesa(p_data_inicio date, p_data_fim date) IS 'Número de pedidos e ticket médio (valor médio de pedidos.total) por mesa no período. Restrito a admin.';

--
-- Name: vendas_por_categoria(date, date); Type: FUNCTION; Schema: public
--

CREATE FUNCTION public.vendas_por_categoria(p_data_inicio date, p_data_fim date) RETURNS TABLE(categoria text, quantidade bigint, receita numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

--
-- Name: FUNCTION vendas_por_categoria(p_data_inicio date, p_data_fim date); Type: COMMENT; Schema: public
--

COMMENT ON FUNCTION public.vendas_por_categoria(p_data_inicio date, p_data_fim date) IS 'Quantidade e receita por categoria de produto no período. Restrito a admin.';

--
-- Name: configuracoes; Type: TABLE; Schema: public
--

CREATE TABLE public.configuracoes (
    chave text NOT NULL,
    valor text NOT NULL
);

--
-- Name: TABLE configuracoes; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.configuracoes IS 'Configurações do bar editáveis pelo admin (admin.html) sem precisar de deploy. Uma linha por chave — hoje só "taxa_servico_percentual".';

--
-- Name: pedido_itens; Type: TABLE; Schema: public
--

CREATE TABLE public.pedido_itens (
    id bigint NOT NULL,
    pedido_id uuid NOT NULL,
    produto_id bigint,
    nome_snapshot text NOT NULL,
    preco_unitario numeric(10,2) NOT NULL,
    quantidade integer NOT NULL,
    compartilhado boolean DEFAULT false NOT NULL,
    pagamento_id uuid,
    CONSTRAINT pedido_itens_preco_unitario_check CHECK ((preco_unitario >= (0)::numeric)),
    CONSTRAINT pedido_itens_quantidade_check CHECK (((quantidade >= 1) AND (quantidade <= 50)))
);

--
-- Name: COLUMN pedido_itens.nome_snapshot; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedido_itens.nome_snapshot IS 'Nome do produto congelado no momento do pedido, pro histórico não mudar se o produto for renomeado depois.';

--
-- Name: COLUMN pedido_itens.preco_unitario; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedido_itens.preco_unitario IS 'Preço congelado no momento do pedido (vem de produtos.preco no instante da criação), nunca do navegador.';

--
-- Name: COLUMN pedido_itens.compartilhado; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedido_itens.compartilhado IS 'true quando o item (hoje, só narguilé) foi marcado como "dividir entre a mesa": no rateio por pessoa, o valor dele é repartido igualmente entre todo mundo com pedido na sessão, em vez de cobrado só de quem pediu.';

--
-- Name: COLUMN pedido_itens.pagamento_id; Type: COMMENT; Schema: public
--

COMMENT ON COLUMN public.pedido_itens.pagamento_id IS 'Pagamento que cobriu este item (só pra itens NÃO compartilhados). Nulo = ainda não foi fechado por ninguém.';

--
-- Name: pedido_itens_id_seq; Type: SEQUENCE; Schema: public
--

ALTER TABLE public.pedido_itens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pedido_itens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: perfis; Type: TABLE; Schema: public
--

CREATE TABLE public.perfis (
    user_id uuid NOT NULL,
    papel text NOT NULL,
    CONSTRAINT perfis_papel_check CHECK ((papel = ANY (ARRAY['admin'::text, 'balcao'::text, 'garcom'::text])))
);

--
-- Name: TABLE perfis; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.perfis IS 'Papel de cada usuário autenticado (admin, balcao ou garcom). Controla quem pode editar produtos (admin) e, com 023_papel_garcom.sql, quem entra em garcom.html (garcom/balcao/admin).';

--
-- Name: produtos; Type: TABLE; Schema: public
--

CREATE TABLE public.produtos (
    id bigint NOT NULL,
    nome text NOT NULL,
    descricao text DEFAULT ''::text NOT NULL,
    preco numeric(10,2) NOT NULL,
    categoria text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    CONSTRAINT produtos_categoria_check CHECK ((categoria = ANY (ARRAY['drink'::text, 'cerveja'::text, 'sem_alcool'::text, 'narguile'::text, 'essencia'::text]))),
    CONSTRAINT produtos_preco_check CHECK ((preco >= (0)::numeric))
);

--
-- Name: TABLE produtos; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.produtos IS 'Catálogo do cardápio. Único dado que o cliente (anon) lê direto da tabela.';

--
-- Name: produtos_id_seq; Type: SEQUENCE; Schema: public
--

ALTER TABLE public.produtos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.produtos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: rateio_compartilhado; Type: TABLE; Schema: public
--

CREATE TABLE public.rateio_compartilhado (
    id bigint NOT NULL,
    pedido_item_id bigint NOT NULL,
    cliente_id uuid NOT NULL,
    valor numeric(10,2) NOT NULL,
    pagamento_id uuid,
    CONSTRAINT rateio_compartilhado_valor_check CHECK ((valor >= (0)::numeric))
);

--
-- Name: TABLE rateio_compartilhado; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.rateio_compartilhado IS 'Fatia de cada pessoa elegível num item compartilhado, congelada no momento em que o item foi pedido (ver criar_pedido). pagamento_id nulo = a fatia dessa pessoa ainda não foi fechada/paga.';

--
-- Name: rateio_compartilhado_id_seq; Type: SEQUENCE; Schema: public
--

ALTER TABLE public.rateio_compartilhado ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rateio_compartilhado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: sessao_tokens; Type: TABLE; Schema: public
--

CREATE TABLE public.sessao_tokens (
    sessao_id uuid NOT NULL,
    token_sessao text DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text) NOT NULL
);

--
-- Name: TABLE sessao_tokens; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.sessao_tokens IS 'Token de sessão (segredo temporário que autoriza pedir/fechar conta numa sessão aberta) — separado de "sessoes" porque aquela tabela é lida direto por anon (Realtime da trava) e esta não pode ser. Só acessível via RPC SECURITY DEFINER.';

--
-- Name: sessoes; Type: TABLE; Schema: public
--

CREATE TABLE public.sessoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mesa integer NOT NULL,
    aberta_em timestamp with time zone DEFAULT now() NOT NULL,
    fechada_em timestamp with time zone,
    status text DEFAULT 'aberta'::text NOT NULL,
    CONSTRAINT sessoes_mesa_check CHECK ((mesa > 0)),
    CONSTRAINT sessoes_status_check CHECK ((status = ANY (ARRAY['aberta'::text, 'fechada'::text])))
);

--
-- Name: TABLE sessoes; Type: COMMENT; Schema: public
--

COMMENT ON TABLE public.sessoes IS 'Uma sessão por "rodada" de clientes numa mesa física, do momento em que o primeiro pedido é feito até o fechamento da conta. Todo pedido (pedidos.sessao_id) pertence a exatamente uma sessão.';

--
-- Name: configuracoes configuracoes_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.configuracoes
    ADD CONSTRAINT configuracoes_pkey PRIMARY KEY (chave);

--
-- Name: mesas mesas_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.mesas
    ADD CONSTRAINT mesas_pkey PRIMARY KEY (numero);

--
-- Name: mesas mesas_token_key; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.mesas
    ADD CONSTRAINT mesas_token_key UNIQUE (token);

--
-- Name: pagamentos pagamentos_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pagamentos
    ADD CONSTRAINT pagamentos_pkey PRIMARY KEY (id);

--
-- Name: pedido_itens pedido_itens_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pedido_itens
    ADD CONSTRAINT pedido_itens_pkey PRIMARY KEY (id);

--
-- Name: pedidos pedidos_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id);

--
-- Name: perfis perfis_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.perfis
    ADD CONSTRAINT perfis_pkey PRIMARY KEY (user_id);

--
-- Name: produtos produtos_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_pkey PRIMARY KEY (id);

--
-- Name: rateio_compartilhado rateio_compartilhado_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.rateio_compartilhado
    ADD CONSTRAINT rateio_compartilhado_pkey PRIMARY KEY (id);

--
-- Name: sessao_tokens sessao_tokens_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.sessao_tokens
    ADD CONSTRAINT sessao_tokens_pkey PRIMARY KEY (sessao_id);

--
-- Name: sessao_tokens sessao_tokens_token_sessao_key; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.sessao_tokens
    ADD CONSTRAINT sessao_tokens_token_sessao_key UNIQUE (token_sessao);

--
-- Name: sessoes sessoes_pkey; Type: CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.sessoes
    ADD CONSTRAINT sessoes_pkey PRIMARY KEY (id);

--
-- Name: idx_pagamentos_cliente_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_pagamentos_cliente_id ON public.pagamentos USING btree (cliente_id);

--
-- Name: idx_pagamentos_sessao_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_pagamentos_sessao_id ON public.pagamentos USING btree (sessao_id);

--
-- Name: idx_pagamentos_status; Type: INDEX; Schema: public
--

CREATE INDEX idx_pagamentos_status ON public.pagamentos USING btree (status);

--
-- Name: idx_pedido_itens_pagamento_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_pedido_itens_pagamento_id ON public.pedido_itens USING btree (pagamento_id);

--
-- Name: idx_pedido_itens_pedido_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_pedido_itens_pedido_id ON public.pedido_itens USING btree (pedido_id);

--
-- Name: idx_pedidos_criado_em; Type: INDEX; Schema: public
--

CREATE INDEX idx_pedidos_criado_em ON public.pedidos USING btree (criado_em);

--
-- Name: idx_pedidos_mesa_status; Type: INDEX; Schema: public
--

CREATE INDEX idx_pedidos_mesa_status ON public.pedidos USING btree (mesa, status);

--
-- Name: idx_pedidos_sessao_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_pedidos_sessao_id ON public.pedidos USING btree (sessao_id);

--
-- Name: idx_rateio_compartilhado_cliente_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_rateio_compartilhado_cliente_id ON public.rateio_compartilhado USING btree (cliente_id);

--
-- Name: idx_rateio_compartilhado_pagamento_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_rateio_compartilhado_pagamento_id ON public.rateio_compartilhado USING btree (pagamento_id);

--
-- Name: idx_rateio_compartilhado_pedido_item_id; Type: INDEX; Schema: public
--

CREATE INDEX idx_rateio_compartilhado_pedido_item_id ON public.rateio_compartilhado USING btree (pedido_item_id);

--
-- Name: idx_sessoes_mesa_aberta_unica; Type: INDEX; Schema: public
--

CREATE UNIQUE INDEX idx_sessoes_mesa_aberta_unica ON public.sessoes USING btree (mesa) WHERE (status = 'aberta'::text);

--
-- Name: idx_sessoes_mesa_status; Type: INDEX; Schema: public
--

CREATE INDEX idx_sessoes_mesa_status ON public.sessoes USING btree (mesa, status);

--
-- Name: sessoes trg_sessao_token_novo; Type: TRIGGER; Schema: public
--

CREATE TRIGGER trg_sessao_token_novo AFTER INSERT ON public.sessoes FOR EACH ROW EXECUTE FUNCTION public._gerar_token_sessao();

--
-- Name: pagamentos pagamentos_sessao_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pagamentos
    ADD CONSTRAINT pagamentos_sessao_id_fkey FOREIGN KEY (sessao_id) REFERENCES public.sessoes(id);

--
-- Name: pedido_itens pedido_itens_pagamento_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pedido_itens
    ADD CONSTRAINT pedido_itens_pagamento_id_fkey FOREIGN KEY (pagamento_id) REFERENCES public.pagamentos(id);

--
-- Name: pedido_itens pedido_itens_pedido_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pedido_itens
    ADD CONSTRAINT pedido_itens_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE CASCADE;

--
-- Name: pedido_itens pedido_itens_produto_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pedido_itens
    ADD CONSTRAINT pedido_itens_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id);

--
-- Name: pedidos pedidos_sessao_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_sessao_id_fkey FOREIGN KEY (sessao_id) REFERENCES public.sessoes(id);

--
-- Name: perfis perfis_user_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.perfis
    ADD CONSTRAINT perfis_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

--
-- Name: rateio_compartilhado rateio_compartilhado_pagamento_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.rateio_compartilhado
    ADD CONSTRAINT rateio_compartilhado_pagamento_id_fkey FOREIGN KEY (pagamento_id) REFERENCES public.pagamentos(id);

--
-- Name: rateio_compartilhado rateio_compartilhado_pedido_item_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.rateio_compartilhado
    ADD CONSTRAINT rateio_compartilhado_pedido_item_id_fkey FOREIGN KEY (pedido_item_id) REFERENCES public.pedido_itens(id);

--
-- Name: sessao_tokens sessao_tokens_sessao_id_fkey; Type: FK CONSTRAINT; Schema: public
--

ALTER TABLE ONLY public.sessao_tokens
    ADD CONSTRAINT sessao_tokens_sessao_id_fkey FOREIGN KEY (sessao_id) REFERENCES public.sessoes(id);

--
-- Name: configuracoes; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

--
-- Name: configuracoes configuracoes_select_admin; Type: POLICY; Schema: public
--

CREATE POLICY configuracoes_select_admin ON public.configuracoes FOR SELECT TO authenticated USING (public.eh_admin());

--
-- Name: configuracoes configuracoes_update_admin; Type: POLICY; Schema: public
--

CREATE POLICY configuracoes_update_admin ON public.configuracoes FOR UPDATE TO authenticated USING (public.eh_admin()) WITH CHECK (public.eh_admin());

--
-- Name: mesas; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.mesas ENABLE ROW LEVEL SECURITY;

--
-- Name: mesas mesas_insert_admin; Type: POLICY; Schema: public
--

CREATE POLICY mesas_insert_admin ON public.mesas FOR INSERT TO authenticated WITH CHECK (public.eh_admin());

--
-- Name: mesas mesas_select_admin; Type: POLICY; Schema: public
--

CREATE POLICY mesas_select_admin ON public.mesas FOR SELECT TO authenticated USING (public.eh_admin());

--
-- Name: mesas mesas_update_admin; Type: POLICY; Schema: public
--

CREATE POLICY mesas_update_admin ON public.mesas FOR UPDATE TO authenticated USING (public.eh_admin()) WITH CHECK (public.eh_admin());

--
-- Name: pagamentos; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;

--
-- Name: pagamentos pagamentos_select_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY pagamentos_select_authenticated ON public.pagamentos FOR SELECT TO authenticated USING (true);

--
-- Name: pedido_itens; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: pedido_itens pedido_itens_select_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY pedido_itens_select_authenticated ON public.pedido_itens FOR SELECT TO authenticated USING (true);

--
-- Name: pedido_itens pedido_itens_update_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY pedido_itens_update_authenticated ON public.pedido_itens FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

--
-- Name: pedidos; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;

--
-- Name: pedidos pedidos_select_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY pedidos_select_authenticated ON public.pedidos FOR SELECT TO authenticated USING (true);

--
-- Name: pedidos pedidos_update_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY pedidos_update_authenticated ON public.pedidos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

--
-- Name: perfis; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;

--
-- Name: perfis perfis_select_proprio; Type: POLICY; Schema: public
--

CREATE POLICY perfis_select_proprio ON public.perfis FOR SELECT TO authenticated USING ((user_id = auth.uid()));

--
-- Name: produtos; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

--
-- Name: produtos produtos_delete_admin; Type: POLICY; Schema: public
--

CREATE POLICY produtos_delete_admin ON public.produtos FOR DELETE TO authenticated USING (public.eh_admin());

--
-- Name: produtos produtos_insert_admin; Type: POLICY; Schema: public
--

CREATE POLICY produtos_insert_admin ON public.produtos FOR INSERT TO authenticated WITH CHECK (public.eh_admin());

--
-- Name: produtos produtos_select_admin; Type: POLICY; Schema: public
--

CREATE POLICY produtos_select_admin ON public.produtos FOR SELECT TO authenticated USING (public.eh_admin());

--
-- Name: produtos produtos_select_ativos_anon; Type: POLICY; Schema: public
--

CREATE POLICY produtos_select_ativos_anon ON public.produtos FOR SELECT TO anon USING ((ativo = true));

--
-- Name: produtos produtos_select_ativos_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY produtos_select_ativos_authenticated ON public.produtos FOR SELECT TO authenticated USING ((ativo = true));

--
-- Name: produtos produtos_update_admin; Type: POLICY; Schema: public
--

CREATE POLICY produtos_update_admin ON public.produtos FOR UPDATE TO authenticated USING (public.eh_admin()) WITH CHECK (public.eh_admin());

--
-- Name: rateio_compartilhado; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.rateio_compartilhado ENABLE ROW LEVEL SECURITY;

--
-- Name: rateio_compartilhado rateio_compartilhado_select_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY rateio_compartilhado_select_authenticated ON public.rateio_compartilhado FOR SELECT TO authenticated USING (true);

--
-- Name: sessao_tokens; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.sessao_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: sessoes; Type: ROW SECURITY; Schema: public
--

ALTER TABLE public.sessoes ENABLE ROW LEVEL SECURITY;

--
-- Name: sessoes sessoes_select_anon; Type: POLICY; Schema: public
--

CREATE POLICY sessoes_select_anon ON public.sessoes FOR SELECT TO anon USING (true);

--
-- Name: sessoes sessoes_select_authenticated; Type: POLICY; Schema: public
--

CREATE POLICY sessoes_select_authenticated ON public.sessoes FOR SELECT TO authenticated USING (true);

--
-- Name: FUNCTION _bloquear_mesa(p_mesa integer); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public._bloquear_mesa(p_mesa integer) FROM PUBLIC;

--
-- Name: FUNCTION _conta_da_mesa_dados(p_sessao_id uuid); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public._conta_da_mesa_dados(p_sessao_id uuid) FROM PUBLIC;

--
-- Name: FUNCTION _minha_parte_dados(p_sessao_id uuid, p_cliente_id uuid); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public._minha_parte_dados(p_sessao_id uuid, p_cliente_id uuid) FROM PUBLIC;

--
-- Name: FUNCTION _nome_norm_do_cliente(p_sessao_id uuid, p_cliente_id uuid); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public._nome_norm_do_cliente(p_sessao_id uuid, p_cliente_id uuid) FROM PUBLIC;

--
-- Name: FUNCTION _sessao_aberta_por_token(p_mesa integer, p_token_sessao text); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public._sessao_aberta_por_token(p_mesa integer, p_token_sessao text) FROM PUBLIC;

--
-- Name: FUNCTION abrir_sessao(p_mesa integer, p_token text); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.abrir_sessao(p_mesa integer, p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abrir_sessao(p_mesa integer, p_token text) TO anon;

--
-- Name: FUNCTION ativar_mesa(p_mesa integer); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.ativar_mesa(p_mesa integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ativar_mesa(p_mesa integer) TO authenticated;

--
-- Name: FUNCTION bloquear_todas_mesas(p_forcar boolean); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.bloquear_todas_mesas(p_forcar boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bloquear_todas_mesas(p_forcar boolean) TO authenticated;

--
-- Name: FUNCTION confirmar_pagamento(p_pagamento_id uuid); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.confirmar_pagamento(p_pagamento_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirmar_pagamento(p_pagamento_id uuid) TO authenticated;

--
-- Name: FUNCTION conta_da_mesa(p_mesa integer, p_token text, p_cliente_id uuid, p_token_sessao text); Type: ACL; Schema: public
--

GRANT ALL ON FUNCTION public.conta_da_mesa(p_mesa integer, p_token text, p_cliente_id uuid, p_token_sessao text) TO anon;

--
-- Name: FUNCTION conta_da_mesa_balcao(p_mesa integer); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.conta_da_mesa_balcao(p_mesa integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.conta_da_mesa_balcao(p_mesa integer) TO authenticated;

--
-- Name: FUNCTION criar_pedido(p_mesa integer, p_token text, p_itens jsonb, p_cliente_nome text, p_cliente_id uuid, p_token_sessao text); Type: ACL; Schema: public
--

GRANT ALL ON FUNCTION public.criar_pedido(p_mesa integer, p_token text, p_itens jsonb, p_cliente_nome text, p_cliente_id uuid, p_token_sessao text) TO anon;

--
-- Name: FUNCTION desativar_mesa(p_mesa integer); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.desativar_mesa(p_mesa integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.desativar_mesa(p_mesa integer) TO authenticated;

--
-- Name: FUNCTION detalhe_pagamento(p_pagamento_id uuid); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.detalhe_pagamento(p_pagamento_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.detalhe_pagamento(p_pagamento_id uuid) TO authenticated;

--
-- Name: FUNCTION eh_admin(); Type: ACL; Schema: public
--

GRANT ALL ON FUNCTION public.eh_admin() TO authenticated;

--
-- Name: FUNCTION eh_garcom(); Type: ACL; Schema: public
--

GRANT ALL ON FUNCTION public.eh_garcom() TO authenticated;

--
-- Name: FUNCTION eh_garcom_ou_balcao(); Type: ACL; Schema: public
--

GRANT ALL ON FUNCTION public.eh_garcom_ou_balcao() TO authenticated;

--
-- Name: FUNCTION encerrar_sessao(p_mesa integer, p_forcar boolean); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.encerrar_sessao(p_mesa integer, p_forcar boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.encerrar_sessao(p_mesa integer, p_forcar boolean) TO authenticated;

--
-- Name: FUNCTION faturamento_por_dia(p_data_inicio date, p_data_fim date); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.faturamento_por_dia(p_data_inicio date, p_data_fim date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.faturamento_por_dia(p_data_inicio date, p_data_fim date) TO authenticated;

--
-- Name: FUNCTION fechar_parcial(p_mesa integer, p_token text, p_cliente_id uuid, p_aceita_taxa boolean); Type: ACL; Schema: public
--

GRANT ALL ON FUNCTION public.fechar_parcial(p_mesa integer, p_token text, p_cliente_id uuid, p_aceita_taxa boolean) TO anon;

--
-- Name: FUNCTION lancar_pedido_garcom(p_mesa integer, p_itens jsonb, p_cliente_nome text); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.lancar_pedido_garcom(p_mesa integer, p_itens jsonb, p_cliente_nome text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lancar_pedido_garcom(p_mesa integer, p_itens jsonb, p_cliente_nome text) TO authenticated;

--
-- Name: FUNCTION liberar_mesa(p_mesa integer); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.liberar_mesa(p_mesa integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.liberar_mesa(p_mesa integer) TO authenticated;

--
-- Name: FUNCTION liberar_todas_mesas(); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.liberar_todas_mesas() FROM PUBLIC;
GRANT ALL ON FUNCTION public.liberar_todas_mesas() TO authenticated;

--
-- Name: FUNCTION listar_mesas_balcao(); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.listar_mesas_balcao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.listar_mesas_balcao() TO authenticated;

--
-- Name: FUNCTION movimento_por_hora(p_data_inicio date, p_data_fim date); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.movimento_por_hora(p_data_inicio date, p_data_fim date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.movimento_por_hora(p_data_inicio date, p_data_fim date) TO authenticated;

--
-- Name: FUNCTION pedir_fechamento(p_mesa integer, p_token text, p_token_sessao text); Type: ACL; Schema: public
--

GRANT ALL ON FUNCTION public.pedir_fechamento(p_mesa integer, p_token text, p_token_sessao text) TO anon;

--
-- Name: FUNCTION produtos_mais_vendidos(p_data_inicio date, p_data_fim date, p_limite integer); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.produtos_mais_vendidos(p_data_inicio date, p_data_fim date, p_limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.produtos_mais_vendidos(p_data_inicio date, p_data_fim date, p_limite integer) TO authenticated;

--
-- Name: FUNCTION regenerar_token_mesa(p_numero integer); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.regenerar_token_mesa(p_numero integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.regenerar_token_mesa(p_numero integer) TO authenticated;

--
-- Name: FUNCTION remover_item_pedido(p_pedido_id uuid, p_item_id bigint); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.remover_item_pedido(p_pedido_id uuid, p_item_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remover_item_pedido(p_pedido_id uuid, p_item_id bigint) TO authenticated;

--
-- Name: FUNCTION sessao_atual(p_mesa integer, p_token text); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.sessao_atual(p_mesa integer, p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sessao_atual(p_mesa integer, p_token text) TO anon;

--
-- Name: FUNCTION status_da_mesa(p_mesa integer, p_token text); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.status_da_mesa(p_mesa integer, p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.status_da_mesa(p_mesa integer, p_token text) TO anon;

--
-- Name: FUNCTION ticket_medio_por_mesa(p_data_inicio date, p_data_fim date); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.ticket_medio_por_mesa(p_data_inicio date, p_data_fim date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ticket_medio_por_mesa(p_data_inicio date, p_data_fim date) TO authenticated;

--
-- Name: FUNCTION vendas_por_categoria(p_data_inicio date, p_data_fim date); Type: ACL; Schema: public
--

REVOKE ALL ON FUNCTION public.vendas_por_categoria(p_data_inicio date, p_data_fim date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vendas_por_categoria(p_data_inicio date, p_data_fim date) TO authenticated;

-- ------------------------------------------------------------------------
-- Realtime (o balcão escuta mudanças nestas tabelas)
-- ------------------------------------------------------------------------

alter publication supabase_realtime add table public.pagamentos, public.pedidos, public.sessoes;

-- ------------------------------------------------------------------------
-- Dados iniciais: configuração da taxa de serviço e cardápio de exemplo
-- ------------------------------------------------------------------------

--
-- Data for Name: configuracoes; Type: TABLE DATA; Schema: public
--

INSERT INTO public.configuracoes (chave, valor) VALUES ('taxa_servico_percentual', '10');

--
-- Data for Name: produtos; Type: TABLE DATA; Schema: public
--

INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (1, 'Caipirinha', 'Cachaça, limão fresco, açúcar e gelo na medida certa.', 18.00, 'drink', true, 1);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (2, 'Moscow Mule', 'Vodka, gengibre, limão e ginger beer geladinha.', 24.00, 'drink', true, 2);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (3, 'Gin Tônica', 'Gin premium, tônica artesanal e toque cítrico.', 26.00, 'drink', true, 3);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (4, 'Aperol Spritz', 'Aperol, espumante e um splash de água com gás.', 28.00, 'drink', true, 4);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (5, 'Negroni', 'Gin, vermute rosso e Campari em partes iguais.', 27.00, 'drink', true, 5);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (6, 'Mojito', 'Rum, hortelã fresca, limão, açúcar e água com gás.', 25.00, 'drink', true, 6);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (7, 'Piña Colada', 'Rum, leite de coco e abacaxi batido com gelo.', 26.00, 'drink', true, 7);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (8, 'Sex on the Beach', 'Vodka, licor de pêssego, suco de laranja e cranberry.', 24.00, 'drink', true, 8);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (9, 'Heineken Long Neck', 'Lager holandesa, leve e refrescante.', 13.00, 'cerveja', true, 1);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (10, 'Original 600ml', 'Pilsen puro malte, clássica pra dividir com a galera.', 18.00, 'cerveja', true, 2);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (11, 'Brahma Duplo Malte', 'Encorpada e cremosa, fácil de tomar.', 10.00, 'cerveja', true, 3);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (12, 'Budweiser Long Neck', 'Lager americana, suave e refrescante.', 11.00, 'cerveja', true, 4);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (13, 'Colorado Indica IPA', 'IPA brasileira com mel, lupulada e amarga.', 22.00, 'cerveja', true, 5);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (14, 'Eisenbahn Weizenbier', 'Weiss brasileira, turva com notas de banana e cravo.', 16.00, 'cerveja', true, 6);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (15, 'Narguilé Completo', 'Montagem completa com essência à sua escolha.', 45.00, 'narguile', true, 1);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (16, 'Troca de Rosh', 'Rosh novo com essência renovada.', 20.00, 'narguile', true, 2);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (17, 'Carvão Extra', 'Porção adicional de carvão natural.', 8.00, 'narguile', true, 3);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (18, 'Essência Dupla', 'Mescla de duas essências no mesmo narguilé.', 10.00, 'narguile', true, 4);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (19, 'Refrigerante Lata', 'Coca, Guaraná, Fanta ou Sprite gelados.', 7.00, 'sem_alcool', true, 1);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (20, 'Suco Natural', 'Feito na hora: laranja, abacaxi ou maracujá.', 12.00, 'sem_alcool', true, 2);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (21, 'Água Mineral', 'Com ou sem gás, 500ml gelada.', 5.00, 'sem_alcool', true, 3);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (22, 'Energético', 'Lata gelada, ideal pra acompanhar o narguilé.', 15.00, 'sem_alcool', true, 4);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (23, 'Menta Ice', 'Refrescante', 0.00, 'essencia', true, 1);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (24, 'Melancia', 'Doce', 0.00, 'essencia', true, 2);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (25, 'Uva', 'Frutado', 0.00, 'essencia', true, 3);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (26, 'Frutas Vermelhas', 'Frutado', 0.00, 'essencia', true, 4);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (27, 'Blueberry', 'Doce', 0.00, 'essencia', true, 5);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (28, 'Maçã Verde', 'Cítrico', 0.00, 'essencia', true, 6);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (29, 'Limão Gelado', 'Cítrico', 0.00, 'essencia', true, 7);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (30, 'Duplo Menta', 'Refrescante', 0.00, 'essencia', true, 8);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (31, 'Abacaxi', 'Tropical', 0.00, 'essencia', true, 9);
INSERT INTO public.produtos (id, nome, descricao, preco, categoria, ativo, ordem) OVERRIDING SYSTEM VALUE VALUES (32, 'Tutti-Frutti', 'Doce', 0.00, 'essencia', true, 10);

--
-- Name: produtos_id_seq; Type: SEQUENCE SET; Schema: public
--

SELECT pg_catalog.setval('public.produtos_id_seq', 32, true);

-- Mesas 1 a 20, cada uma com um token novo gerado aqui mesmo (default da coluna)
insert into public.mesas (numero)
select numero from generate_series(1, 20) as gerar(numero)
on conflict (numero) do nothing;
