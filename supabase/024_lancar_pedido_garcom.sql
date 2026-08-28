-- ========================================================================
-- AOOBA! BAR — garçom lança pedido sem QR code, restrito ao papel garcom (migração 024)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
-- Pré-requisitos: 008_sessoes.sql (sessoes, criar_pedido), 019_bloqueio_mesa.sql
-- (status_mesa), 023_papel_garcom.sql (papel 'garcom' em perfis).
--
-- PROBLEMA: criar_pedido (008/017/019) é a porta de entrada do CLIENTE
-- (anon) — a prova de "está sentado nessa mesa" é possuir o token secreto
-- da mesa (do QR) + o token de sessão. Cliente sem celular pra escanear
-- não tem como pedir. O garçom logado (garcom.html) não tem — e não deve
-- ter — acesso ao token da mesa (isso é exclusivo do admin, ver
-- mesas_select_admin em 005_seguranca.sql); a autorização dele é outra:
-- estar autenticado com papel garcom.
--
-- SOLUÇÃO: RPC nova (lancar_pedido_garcom) que reaproveita a MESMA lógica
-- de validação/preço/sessão de criar_pedido, só que autoriza por PAPEL em
-- vez de TOKEN — e, por pedido explícito, só papel 'garcom' passa (nem
-- balcao nem admin, diferente do resto de garcom.html/023_papel_garcom.sql
-- que aceita os três). Preço sempre recalculado no banco a partir de
-- produtos.preco — nunca confia em valor vindo do navegador, mesma
-- garantia de sempre.
-- ========================================================================

-- ========================================================================
-- COLUNA: pedidos.origem (cliente x garçom)
-- ========================================================================
-- Marca de onde o pedido veio, pra distinguir na fila do balcão/garçom e
-- em relatórios futuros. DEFAULT 'cliente' preenche sozinho os pedidos que
-- já existem e os que continuarem vindo por criar_pedido (que não muda
-- nesta migração — nasce com o default, sem precisar tocar nele).

alter table pedidos
  add column if not exists origem text not null default 'cliente'
    check (origem in ('cliente', 'garcom'));

comment on column pedidos.origem is '"cliente": feito pelo próprio cliente via QR code (criar_pedido). "garcom": lançado pelo garçom sem QR, pra cliente sem celular (ver lancar_pedido_garcom, 024).';

-- ========================================================================
-- POLICY: produtos_select_ativos_authenticated
-- ========================================================================
-- Garçom precisa ler o cardápio (produtos ativos) pra montar o pedido na
-- tela — RLS de "produtos" hoje só libera SELECT pra anon (ativo=true,
-- 001_schema.sql) ou pra admin (produtos_select_admin, 003_admin.sql);
-- authenticated sem papel admin recebia 0 linhas em silêncio (RLS sem
-- policy aplicável filtra tudo, não dá erro). Esta policy espelha a de
-- anon, só que pra "authenticated" — nenhum dado sensível é exposto (é o
-- mesmo cardápio que qualquer cliente já vê no QR code).

create policy "produtos_select_ativos_authenticated"
  on produtos for select
  to authenticated
  using (ativo = true);

-- ========================================================================
-- FUNÇÕES: eh_garcom() / _exigir_garcom()
-- ========================================================================
-- Mesmo padrão de eh_admin()/_exigir_admin() (003/004) — só que checando
-- especificamente papel = 'garcom' (não balcao, não admin: foi pedido
-- explícito manter essa ação exclusiva do papel garçom, diferente do
-- eh_garcom_ou_balcao() de 023, que aceita os três pro resto da tela).

create or replace function public.eh_garcom()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from perfis
    where user_id = auth.uid() and papel = 'garcom'
  );
$$;

comment on function public.eh_garcom() is 'true se o usuário logado tem papel garcom (só garcom — nem balcao nem admin) em "perfis". Usado por lancar_pedido_garcom.';

grant execute on function public.eh_garcom() to authenticated;

create or replace function public._exigir_garcom()
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.eh_garcom() then
    raise exception 'Acesso restrito ao papel garçom.' using errcode = '42501';
  end if;
end;
$$;

comment on function public._exigir_garcom() is 'Barra a execução com exceção se o usuário logado não tiver papel garcom (nem balcao nem admin passam aqui). Usada só internamente por lancar_pedido_garcom.';

-- ========================================================================
-- RPC: lancar_pedido_garcom
-- ========================================================================
-- Mesma validação/preço/sessão de criar_pedido (019_bloqueio_mesa.sql),
-- adaptada pro garçom: sem token de mesa, sem token de sessão, sem limite
-- por pessoa (cliente_id aqui é só um identificador técnico novo a cada
-- pedido, não um aparelho de verdade) — só o limite de segurança por mesa
-- (rede de segurança contra clique duplicado/loop). Recusa com
-- MESA_BLOQUEADA se a mesa estiver bloqueada — a TELA decide o que fazer
-- (oferecer liberar_mesa antes de tentar de novo), a RPC não libera
-- sozinha.

create or replace function public.lancar_pedido_garcom(
  p_mesa         int,
  p_itens        jsonb,
  p_cliente_nome text default null
)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
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

comment on function public.lancar_pedido_garcom(int, jsonb, text) is 'Lança um pedido numa mesa sem precisar do token de QR — pro garçom atender cliente sem celular. Restrito ao papel garcom (_exigir_garcom, nem balcao nem admin). Recusa com MESA_BLOQUEADA se a mesa estiver bloqueada (a tela deve chamar liberar_mesa antes). Preço sempre recalculado a partir de produtos.preco.';

revoke all on function public.lancar_pedido_garcom(int, jsonb, text) from public;
grant execute on function public.lancar_pedido_garcom(int, jsonb, text) to authenticated;
