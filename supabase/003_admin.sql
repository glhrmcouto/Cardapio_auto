-- ========================================================================
-- AOOBA! BAR — papéis de usuário (admin) + RLS de escrita em produtos
-- (migração 003 — pré-requisito do admin.html)
-- ========================================================================

-- ========================================================================
-- TABELA: perfis
-- ========================================================================
-- Um usuário do Supabase Auth (auth.users) só existe pra logar; o papel dele
-- dentro do sistema (admin ou balcão) fica aqui. O app nunca deixa o próprio
-- usuário se atribuir um papel — isso só é feito manualmente, rodando o
-- INSERT no final deste arquivo.

create table perfis (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  papel    text not null check (papel in ('admin', 'balcao'))
);

comment on table perfis is 'Papel de cada usuário autenticado (admin ou balcao). Controla quem pode editar produtos.';

alter table perfis enable row level security;

-- Cada usuário só pode ler o próprio papel (não precisa ver o papel de outros)
create policy "perfis_select_proprio"
  on perfis for select
  to authenticated
  using (user_id = auth.uid());

-- Nenhuma policy de INSERT/UPDATE/DELETE de propósito: papéis só são atribuídos
-- manualmente pelo SQL Editor (dono do projeto), nunca pelo próprio app.

-- ========================================================================
-- FUNÇÃO AUXILIAR: eh_admin()
-- ========================================================================
-- security definer evita qualquer problema de recursão de RLS ao ser chamada
-- de dentro de outra policy (o padrão recomendado pelo próprio Supabase para
-- checagens de papel/role usadas em policies).

create or replace function public.eh_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfis
    where user_id = auth.uid() and papel = 'admin'
  );
$$;

comment on function public.eh_admin() is 'true se o usuário logado tem papel admin em "perfis". Usado nas policies de escrita de produtos.';

grant execute on function public.eh_admin() to authenticated;

-- ========================================================================
-- RLS DE PRODUTOS: SELECT (todos, inclusive inativos) + INSERT/UPDATE/DELETE
-- só para admin
-- ========================================================================
-- A policy de SELECT pra anon (produtos_select_ativos_anon, do 001_schema.sql)
-- só libera ativo = true e continua igual — ela não vale pra "authenticated",
-- então sem a policy abaixo o admin.html consultava produtos e recebia SEMPRE
-- 0 linhas (RLS sem policy aplicável não dá erro, só filtra tudo em silêncio).

create policy "produtos_select_admin"
  on produtos for select
  to authenticated
  using (public.eh_admin());

create policy "produtos_insert_admin"
  on produtos for insert
  to authenticated
  with check (public.eh_admin());

create policy "produtos_update_admin"
  on produtos for update
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

create policy "produtos_delete_admin"
  on produtos for delete
  to authenticated
  using (public.eh_admin());

-- Nada extra é preciso pra bloquear a exclusão de um produto que já foi pedido:
-- a FK "pedido_itens.produto_id references produtos(id)" (já criada no
-- 001_schema.sql, sem "on delete cascade") já faz o Postgres recusar o DELETE
-- sozinho nesse caso. O admin.html só precisa capturar esse erro e mostrar a
-- mensagem "desative em vez de excluir".

-- ========================================================================
-- ÚLTIMO PASSO (rodar manualmente, com o e-mail do usuário certo):
-- Você disse que o usuário do balcão já existe — dá pra usar o mesmo pra
-- administrar o cardápio. Troque o e-mail abaixo pelo e-mail desse usuário
-- (o mesmo que você usa pra logar em balcao.html) e rode só este INSERT:
-- ========================================================================
--
insert into perfis (user_id, papel)
select id, 'admin' from auth.users where email = 'adminbalcao@aooba.com';
--
-- Se no futuro você quiser um usuário separado só pra atender mesa (sem poder
-- editar o cardápio), crie um novo em Authentication → Users e rode o mesmo
-- INSERT trocando 'admin' por 'balcao' — mas note que balcao.html hoje aceita
-- qualquer usuário autenticado, independente do papel; essa distinção só é
-- checada pelo admin.html.
