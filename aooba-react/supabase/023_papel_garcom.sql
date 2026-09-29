-- ========================================================================
-- AOOBA! BAR — papel 'garcom' em perfis + checagem reutilizável (migração 023)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
-- Pré-requisito: 003_admin.sql (tabela perfis, eh_admin()).
--
-- CONTEXTO: até aqui, "perfis.papel" só aceitava 'admin' ou 'balcao'
-- (003_admin.sql) — mas na prática NENHUMA tela checava 'balcao' de
-- verdade: balcao.html aceita QUALQUER conta autenticada, sem olhar papel
-- nenhum (ver comentário no fim de 003_admin.sql). garcom.html muda isso:
-- é a primeira tela que exige um papel específico pra entrar (garcom, ou
-- balcao/admin — que também podem operar o salão).
--
-- ATENÇÃO — PASSO MANUAL NECESSÁRIO: se a conta que hoje loga em
-- balcao.html NUNCA recebeu uma linha em "perfis" (o normal, já que
-- balcao.html nunca checou isso), ela vai ser BARRADA em garcom.html até
-- você rodar um INSERT pra ela — veja o bloco comentado no fim deste
-- arquivo. balcao.html continua funcionando igual, sem exigir nada disso.
-- ========================================================================

-- ========================================================================
-- CONSTRAINT: perfis.papel passa a aceitar 'garcom'
-- ========================================================================
-- Nome do constraint gerado automaticamente pelo Postgres a partir da
-- definição inline em 003_admin.sql ("papel text ... check (...)") segue o
-- padrão "<tabela>_<coluna>_check" — "if exists" torna o drop seguro mesmo
-- se algum dia o nome mudar por outro motivo.

alter table perfis drop constraint if exists perfis_papel_check;

alter table perfis
  add constraint perfis_papel_check check (papel in ('admin', 'balcao', 'garcom'));

comment on table perfis is 'Papel de cada usuário autenticado (admin, balcao ou garcom). Controla quem pode editar produtos (admin) e, com 023_papel_garcom.sql, quem entra em garcom.html (garcom/balcao/admin).';

-- ========================================================================
-- FUNÇÃO: eh_garcom_ou_balcao()
-- ========================================================================
-- Mesmo padrão de eh_admin() (003_admin.sql): security definer, stable,
-- concedida pra authenticated — qualquer tela ou RPC futura pode chamar
-- pra checar se quem está logado pode operar o salão. admin SEMPRE passa
-- aqui também (já pode tudo; não faz sentido um admin ficar de fora de uma
-- tela operacional).

create or replace function public.eh_garcom_ou_balcao()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfis
    where user_id = auth.uid() and papel in ('garcom', 'balcao', 'admin')
  );
$$;

comment on function public.eh_garcom_ou_balcao() is 'true se o usuário logado tem papel garcom, balcao ou admin em "perfis". Usado por garcom.html (client-side, mesmo padrão de eh_admin() em admin.js) e por qualquer RPC futura que precise da mesma checagem.';

grant execute on function public.eh_garcom_ou_balcao() to authenticated;

-- ========================================================================
-- FUNÇÃO PRIVADA: _exigir_garcom_ou_balcao()
-- ========================================================================
-- Mesmo padrão de _exigir_admin() (004_relatorios.sql): não concedida pra
-- "authenticated" de propósito — só pra ser chamada de DENTRO de futuras
-- RPCs SECURITY DEFINER que precisem barrar quem não seja garcom/balcao/
-- admin no próprio banco (defesa em profundidade, não só na tela). Nenhuma
-- RPC usada por garcom.html precisa dela ainda: ativar_mesa, desativar_mesa,
-- liberar_mesa, liberar_todas_mesas, bloquear_todas_mesas, encerrar_sessao
-- e a atualização de status de entrega (UPDATE em pedidos via RLS
-- pedidos_update_authenticated) já são liberadas pra QUALQUER authenticated,
-- sem checagem de papel — um garçom logado já consegue chamar todas elas
-- hoje. Fica pronta aqui pra quando a Etapa 4 (lançar pedido) precisar de
-- uma RPC nova com esse nível de restrição.

create or replace function public._exigir_garcom_ou_balcao()
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.eh_garcom_ou_balcao() then
    raise exception 'Acesso restrito a garçom, balcão ou administrador.' using errcode = '42501';
  end if;
end;
$$;

comment on function public._exigir_garcom_ou_balcao() is 'Barra a execução com exceção se o usuário logado não tiver papel garcom/balcao/admin em "perfis". Usada internamente por futuras RPCs que precisem restringir a quem opera o salão.';

-- ========================================================================
-- ÚLTIMO PASSO (rodar manualmente, com o e-mail do usuário certo):
-- Sem isso, NINGUÉM entra em garcom.html — nem a conta que já loga em
-- balcao.html, se ela nunca recebeu uma linha em "perfis".
-- ========================================================================
--
-- Pra dar acesso à MESMA conta que já usa balcao.html hoje (ela pode
-- continuar usando as duas telas):
--
-- insert into perfis (user_id, papel)
-- select id, 'balcao' from auth.users where email = 'adminbalcao@aooba.com'
-- on conflict (user_id) do update set papel = excluded.papel;
--
-- Pra criar um usuário SÓ pro garçom (sem acesso a admin.html), crie a
-- conta em Authentication → Users e rode:
--
-- insert into perfis (user_id, papel)
-- select id, 'garcom' from auth.users where email = 'email-do-garcom@aooba.com'
-- on conflict (user_id) do update set papel = excluded.papel;
