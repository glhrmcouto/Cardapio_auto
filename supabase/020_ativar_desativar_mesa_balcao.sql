-- ========================================================================
-- AOOBA! BAR — ativar/desativar mesa direto do painel do balcão (migração 020)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
-- Pré-requisito: 005_seguranca.sql (tabela mesas, mesas.ativa),
-- 019_bloqueio_mesa.sql (painel "Controle de Mesas" em balcao.html).
--
-- PROBLEMA: até aqui, "ativa" (mesa existir no sistema pro cliente) só
-- podia ser alternada no admin.html (mesas_update_admin exige eh_admin() —
-- ver 005_seguranca.sql), mas balcao.html aceita QUALQUER conta autenticada,
-- não só admin (ver comentário no fim de 003_admin.sql). Um garçom que
-- precisa tirar uma mesa de circulação na hora (quebrou, foi remanejada
-- etc.) — ou religar uma que tinha sido desativada — tinha que sair do
-- balcão e entrar no admin pra isso.
--
-- SOLUÇÃO: duas RPCs simétricas, mesmo padrão de liberar_mesa (019) e
-- remover_item_pedido (018) — SECURITY DEFINER, restritas a "authenticated"
-- (qualquer conta do balcão, não só admin), sem abrir uma policy de UPDATE
-- direta na tabela (que exporia o token junto, já que RLS de "mesas" é
-- tudo-ou-nada por linha). admin.html continua podendo fazer a mesma coisa
-- (via update direto, RLS mesas_update_admin) — as duas formas convivem.
-- ========================================================================

create or replace function public.desativar_mesa(p_mesa int)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

comment on function public.desativar_mesa(int) is 'Desativa uma mesa (ativa=false), tirando-a de circulação pro cliente — mesmo efeito de desativar em admin.html, só que chamável direto do balcão. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

revoke all on function public.desativar_mesa(int) from public;
grant execute on function public.desativar_mesa(int) to authenticated;

create or replace function public.ativar_mesa(p_mesa int)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

comment on function public.ativar_mesa(int) is 'Reativa uma mesa (ativa=true), devolvendo-a pro cardápio do cliente — mesmo efeito de ativar em admin.html, só que chamável direto do balcão. Restrito a authenticated (qualquer conta do balcão, não só admin — mesmo padrão de liberar_mesa).';

revoke all on function public.ativar_mesa(int) from public;
grant execute on function public.ativar_mesa(int) to authenticated;
