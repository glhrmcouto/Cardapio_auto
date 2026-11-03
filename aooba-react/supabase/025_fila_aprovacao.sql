-- ========================================================================
-- AOOBA! BAR — fila de aprovação: garçom confirma "o João está na mesa" (migração 025)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
-- Pré-requisitos: 019_bloqueio_mesa.sql (status_mesa, liberar_mesa, status_da_mesa),
-- 021_mesa_inicia_bloqueada.sql (mesa nasce bloqueada).
--
-- PROBLEMA: hoje a mesa bloqueada só mostra "chame um atendente" e o garçom
-- libera a mesa INTEIRA no painel, sem saber QUEM pediu. Não há como o garçom
-- conferir "tem mesmo um João sentado na mesa 5?" antes de liberar.
--
-- SOLUÇÃO: numa mesa bloqueada o cliente informa o nome e entra numa FILA de
-- aprovação (solicitacoes_entrada). O garçom vê "João — Mesa 5", confirma que
-- a pessoa está lá e aprova (ou recusa). Aprovar libera a mesa (liberar_mesa),
-- então abrir_sessao/criar_pedido continuam sendo a defesa de verdade: nenhuma
-- RPC de pedido mudou.
--
-- LIMITE CONHECIDO: a aprovação libera a MESA, como já era. Quem escanear
-- depois que ela estiver liberada não passa pela fila (mesmo comportamento de
-- antes pra um 2º cliente na mesma conta). Recusar mantém a mesa bloqueada.
-- ========================================================================

create table if not exists public.solicitacoes_entrada (
  id           uuid primary key default gen_random_uuid(),
  mesa         int  not null references public.mesas (numero) on delete cascade,
  cliente_id   uuid not null,
  nome         text not null check (char_length(nome) between 1 and 20),
  status       text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada')),
  criado_em    timestamptz not null default now(),
  decidido_em  timestamptz,
  decidido_por uuid
);

comment on table public.solicitacoes_entrada is 'Fila de aprovação do garçom: pedido de entrada numa mesa bloqueada, com o nome que a pessoa informou. Só acessada por RPCs SECURITY DEFINER (RLS ligado, sem policy), exceto o SELECT do garçom (Realtime).';

-- No máximo UMA pendente por pessoa+mesa (reenvio só atualiza o nome).
create unique index if not exists solicitacoes_entrada_pendente_uk
  on public.solicitacoes_entrada (mesa, cliente_id) where status = 'pendente';

create index if not exists solicitacoes_entrada_fila_idx
  on public.solicitacoes_entrada (criado_em) where status = 'pendente';

alter table public.solicitacoes_entrada enable row level security;

-- Garçom/balcão (authenticated) só LÊ, pra assinar o Realtime. Anônimo não vê nada.
drop policy if exists solicitacoes_select_authenticated on public.solicitacoes_entrada;
create policy solicitacoes_select_authenticated on public.solicitacoes_entrada
  for select to authenticated using (true);

alter publication supabase_realtime add table public.solicitacoes_entrada;

-- ========================================================================
-- RPC (anon): solicitar_entrada
-- ========================================================================
-- Mesa liberada não precisa de fila: devolve 'aprovada' sem criar linha.
-- Limites: 10 pendentes por mesa (anti-spam de quem tem o link) e pendentes
-- com mais de 2h não contam (a pessoa foi embora).

create or replace function public.solicitar_entrada(p_mesa int, p_token text, p_cliente_id uuid, p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa  mesas;
  v_nome  text := nullif(trim(coalesce(p_nome, '')), '');
  v_id    uuid;
begin
  if p_cliente_id is null or v_nome is null or char_length(v_nome) > 20 then
    raise exception 'Informe seu nome (até 20 caracteres).';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível pedir a liberação. Verifique o QR code da mesa.';
  end if;

  if v_mesa.status_mesa = 'liberada' then
    return jsonb_build_object('id', null, 'status', 'aprovada');
  end if;

  -- expira pendências velhas dessa mesa
  update solicitacoes_entrada set status = 'recusada', decidido_em = now()
  where mesa = p_mesa and status = 'pendente' and criado_em < now() - interval '2 hours';

  select id into v_id from solicitacoes_entrada
  where mesa = p_mesa and cliente_id = p_cliente_id and status = 'pendente';

  if found then
    update solicitacoes_entrada set nome = v_nome where id = v_id;
    return jsonb_build_object('id', v_id, 'status', 'pendente');
  end if;

  if (select count(*) from solicitacoes_entrada where mesa = p_mesa and status = 'pendente') >= 10 then
    raise exception 'Muitos pedidos aguardando nesta mesa. Chame um atendente.';
  end if;

  insert into solicitacoes_entrada (mesa, cliente_id, nome)
  values (p_mesa, p_cliente_id, v_nome)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pendente');
end;
$$;

comment on function public.solicitar_entrada(int, text, uuid, text) is 'Cliente pede entrada numa mesa bloqueada informando o nome; vira item da fila do garçom. Mesa liberada devolve status aprovada sem criar fila. Exige o token da mesa.';

-- ========================================================================
-- RPC (anon): status_solicitacao — o cliente acompanha a decisão
-- ========================================================================
-- Devolve o status da solicitação MAIS RECENTE da pessoa nessa mesa
-- ('pendente' | 'aprovada' | 'recusada') ou null se nunca pediu.

create or replace function public.status_solicitacao(p_mesa int, p_token text, p_cliente_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mesa mesas;
  v_status text;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar a mesa. Verifique o QR code da mesa.';
  end if;

  select status into v_status from solicitacoes_entrada
  where mesa = p_mesa and cliente_id = p_cliente_id
  order by criado_em desc
  limit 1;

  return v_status;
end;
$$;

comment on function public.status_solicitacao(int, text, uuid) is 'Status da solicitação de entrada mais recente da pessoa na mesa (pendente/aprovada/recusada) ou null. Exige o token da mesa.';

-- ========================================================================
-- RPCs (authenticated): fila do garçom
-- ========================================================================
-- Mesmo padrão de liberar_mesa: qualquer conta logada do salão (a tela do
-- garçom já filtra por papel).

create or replace function public.listar_solicitacoes()
returns table (id uuid, mesa int, nome text, criado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.mesa, s.nome, s.criado_em
  from solicitacoes_entrada s
  join mesas m on m.numero = s.mesa
  where s.status = 'pendente'
    and m.status_mesa = 'bloqueada'
    and s.criado_em > now() - interval '2 hours'
  order by s.criado_em;
$$;

comment on function public.listar_solicitacoes() is 'Fila de aprovação: pedidos de entrada pendentes em mesas ainda bloqueadas, do mais antigo pro mais novo.';

create or replace function public.aprovar_solicitacao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa int;
begin
  update solicitacoes_entrada
  set status = 'aprovada', decidido_em = now(), decidido_por = auth.uid()
  where id = p_id and status = 'pendente'
  returning mesa into v_mesa;

  if not found then
    raise exception 'Este pedido já foi decidido ou não existe mais.';
  end if;

  perform public.liberar_mesa(v_mesa);
end;
$$;

comment on function public.aprovar_solicitacao(uuid) is 'Garçom confirma que a pessoa está na mesa: marca a solicitação como aprovada e libera a mesa (liberar_mesa).';

create or replace function public.recusar_solicitacao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update solicitacoes_entrada
  set status = 'recusada', decidido_em = now(), decidido_por = auth.uid()
  where id = p_id and status = 'pendente';

  if not found then
    raise exception 'Este pedido já foi decidido ou não existe mais.';
  end if;
end;
$$;

comment on function public.recusar_solicitacao(uuid) is 'Garçom não encontrou a pessoa na mesa: marca como recusada. A mesa continua bloqueada.';

-- ========================================================================
-- GRANTS
-- ========================================================================
revoke all on function public.solicitar_entrada(int, text, uuid, text) from public;
revoke all on function public.status_solicitacao(int, text, uuid) from public;
revoke all on function public.listar_solicitacoes() from public;
revoke all on function public.aprovar_solicitacao(uuid) from public;
revoke all on function public.recusar_solicitacao(uuid) from public;

grant execute on function public.solicitar_entrada(int, text, uuid, text) to anon, authenticated;
grant execute on function public.status_solicitacao(int, text, uuid) to anon, authenticated;
grant execute on function public.listar_solicitacoes() to authenticated;
grant execute on function public.aprovar_solicitacao(uuid) to authenticated;
grant execute on function public.recusar_solicitacao(uuid) to authenticated;
