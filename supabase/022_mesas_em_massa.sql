-- ========================================================================
-- AOOBA! BAR — ações em massa de mesas: liberar/bloquear todas (migração 022)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
-- Pré-requisitos: 008_sessoes.sql (tabela sessoes), 019_bloqueio_mesa.sql
-- (status_mesa, liberar_mesa, painel "Controle de Mesas" em balcao.html),
-- 021_mesa_inicia_bloqueada.sql (mesa nasce bloqueada).
--
-- PROBLEMA: com 021, toda mesa nasce bloqueada e o bar inteiro passa a
-- exigir liberação mesa por mesa — na abertura do salão, isso significa
-- clicar "Liberar mesa" uma por uma em toda mesa ativa. E no fechamento
-- da casa, o inverso: bloquear mesa por mesa pra travar o QR de quem for
-- embora. As duas RPCs abaixo cobrem esses dois momentos em massa, sem
-- abrir mão da regra de 019 (fechamento total continua bloqueando sozinho;
-- liberar_mesa continua existindo pro caso de uma mesa por vez).
--
-- Nenhuma das duas mexe em "ativa" nem em "token" — só em status_mesa,
-- igual liberar_mesa/desativar_mesa/ativar_mesa.
-- ========================================================================

-- ========================================================================
-- RPC: liberar_todas_mesas
-- ========================================================================
-- Libera de uma vez toda mesa ATIVA (mesa inativa não interessa: não
-- aparece pro cliente de qualquer forma). Sem exceção — liberar não
-- interrompe nada em andamento, então não precisa de p_forcar nem de
-- checar sessão aberta.

create or replace function public.liberar_todas_mesas()
returns int
language plpgsql
security definer
set search_path = public
as $$
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

comment on function public.liberar_todas_mesas() is 'Libera (status_mesa=''liberada'') todas as mesas ativas de uma vez — uso típico: abertura do salão, depois de 021_mesa_inicia_bloqueada.sql fazer toda mesa nascer bloqueada. Retorna quantas mesas foram liberadas. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

revoke all on function public.liberar_todas_mesas() from public;
grant execute on function public.liberar_todas_mesas() to authenticated;

-- ========================================================================
-- RPC: bloquear_todas_mesas
-- ========================================================================
-- Por padrão (p_forcar = false), PULA mesa ativa com sessão aberta —
-- bloquear uma mesa com gente ainda consumindo tiraria o cardápio dela no
-- meio do atendimento (mesma proteção de espírito que encerrar_sessao tem
-- pra saldo em aberto, ver 019/009). Com p_forcar = true, bloqueia mesmo
-- assim — uso excepcional (fim da noite, fechar a casa), sempre sob toque
-- explícito de quem já viu o aviso de quantas mesas têm conta aberta.

create or replace function public.bloquear_todas_mesas(p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

comment on function public.bloquear_todas_mesas(boolean) is 'Bloqueia (status_mesa=''bloqueada'') toda mesa ativa de uma vez — uso típico: fechar a casa. Por padrão PULA mesa com sessão aberta (conta em andamento) e devolve {bloqueadas, puladas}; com p_forcar=true bloqueia mesmo as com sessão aberta (puladas sempre 0 nesse caso). Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

revoke all on function public.bloquear_todas_mesas(boolean) from public;
grant execute on function public.bloquear_todas_mesas(boolean) to authenticated;
