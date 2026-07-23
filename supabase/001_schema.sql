-- ========================================================================
-- AOOBA! BAR — schema inicial (migração 001)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
--
-- Padrão de segurança usado neste arquivo:
--   - "produtos" é a única tabela legível diretamente pelo cliente (anon),
--     e só os itens ativos.
--   - "pedidos" e "pedido_itens" NUNCA são gravados direto pelo cliente.
--     Toda escrita passa pelas funções RPC abaixo (criar_pedido,
--     pedir_fechamento), que são SECURITY DEFINER: rodam com o dono das
--     tabelas (quem executa este script, normalmente o superusuário do
--     projeto) e por isso ignoram o RLS na hora de inserir — mas ainda
--     assim validam tudo (mesa, quantidade, produto ativo, preço real)
--     antes de gravar. É esse desenho que impede o navegador de mandar
--     um preço fraudado ou inserir um pedido "fantasma" direto na tabela.
-- ========================================================================

create extension if not exists "pgcrypto";

-- ========================================================================
-- TABELAS
-- ========================================================================

create table produtos (
  id          bigint generated always as identity primary key,
  nome        text not null,
  descricao   text not null default '',
  preco       numeric(10, 2) not null check (preco >= 0),
  categoria   text not null check (categoria in ('drink', 'cerveja', 'sem_alcool', 'narguile', 'essencia')),
  ativo       boolean not null default true,
  ordem       int not null default 0
);

comment on table produtos is 'Catálogo do cardápio. Único dado que o cliente (anon) lê direto da tabela.';

create table pedidos (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('pedido', 'fechar_conta')),
  mesa       int not null check (mesa > 0),
  total      numeric(10, 2) not null default 0 check (total >= 0),
  status     text not null default 'pendente' check (status in ('pendente', 'entregue', 'finalizado')),
  criado_em  timestamptz not null default now()
);

comment on table pedidos is 'Pedidos e solicitações de fechamento de conta. Gravado somente via RPC (criar_pedido / pedir_fechamento).';

create table pedido_itens (
  id              bigint generated always as identity primary key,
  pedido_id       uuid not null references pedidos (id) on delete cascade,
  produto_id      bigint references produtos (id),
  nome_snapshot   text not null,
  preco_unitario  numeric(10, 2) not null check (preco_unitario >= 0),
  quantidade      int not null check (quantidade between 1 and 50)
);

comment on column pedido_itens.nome_snapshot is 'Nome do produto congelado no momento do pedido, pro histórico não mudar se o produto for renomeado depois.';
comment on column pedido_itens.preco_unitario is 'Preço congelado no momento do pedido (vem de produtos.preco no instante da criação), nunca do navegador.';

-- ========================================================================
-- ÍNDICES
-- ========================================================================

create index idx_pedidos_mesa_status on pedidos (mesa, status);
create index idx_pedidos_criado_em on pedidos (criado_em);

-- Não pedido explicitamente na especificação, mas toda FK usada em JOIN/CASCADE
-- no Postgres se beneficia de um índice próprio (evita full scan em pedido_itens
-- a cada conta_da_mesa() e agiliza o "on delete cascade" ao apagar um pedido).
create index idx_pedido_itens_pedido_id on pedido_itens (pedido_id);

-- ========================================================================
-- RLS
-- ========================================================================

alter table produtos enable row level security;
alter table pedidos enable row level security;
alter table pedido_itens enable row level security;

-- produtos: leitura pública, só dos itens ativos (nada de INSERT/UPDATE/DELETE por anon)
create policy "produtos_select_ativos_anon"
  on produtos for select
  to anon
  using (ativo = true);

-- pedidos: nenhum acesso direto para anon. authenticated (tela do balcão) pode ler e atualizar.
create policy "pedidos_select_authenticated"
  on pedidos for select
  to authenticated
  using (true);

create policy "pedidos_update_authenticated"
  on pedidos for update
  to authenticated
  using (true)
  with check (true);

-- pedido_itens: mesma regra de pedidos (o balcão precisa ler os itens pra montar os cards)
create policy "pedido_itens_select_authenticated"
  on pedido_itens for select
  to authenticated
  using (true);

create policy "pedido_itens_update_authenticated"
  on pedido_itens for update
  to authenticated
  using (true)
  with check (true);

-- Nenhuma policy de INSERT/DELETE é criada de propósito: a única forma de gravar
-- em pedidos/pedido_itens é através das funções RPC abaixo (SECURITY DEFINER).

-- ========================================================================
-- RPC: criar_pedido
-- ========================================================================
-- Recebe p_itens no formato: [{"produto_id": 1, "quantidade": 2}, ...]
-- Busca o preço real em "produtos" (ignora qualquer preço vindo do navegador),
-- valida tudo e só então grava o pedido + os itens. Retorna a linha de pedidos criada.

create or replace function public.criar_pedido(p_mesa int, p_itens jsonb)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido      pedidos;
  v_total       numeric(10, 2) := 0;
  v_item        jsonb;
  v_produto     produtos;
  v_quantidade  int;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  -- 1ª passada: valida TODOS os itens e calcula o total antes de gravar qualquer coisa
  -- (assim um item inválido no meio da lista não deixa o pedido gravado pela metade).
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_quantidade := (v_item ->> 'quantidade')::int;

    if v_quantidade is null or v_quantidade < 1 or v_quantidade > 50 then
      raise exception 'Quantidade inválida para um dos itens (deve ser entre 1 e 50).';
    end if;

    select * into v_produto
    from produtos
    where id = (v_item ->> 'produto_id')::bigint
      and ativo = true;

    if not found then
      raise exception 'Produto % não encontrado ou indisponível.', (v_item ->> 'produto_id');
    end if;

    v_total := v_total + (v_produto.preco * v_quantidade);
  end loop;

  insert into pedidos (tipo, mesa, total, status)
  values ('pedido', p_mesa, v_total, 'pendente')
  returning * into v_pedido;

  -- 2ª passada: agora grava os itens, já sabendo que todos são válidos
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_quantidade := (v_item ->> 'quantidade')::int;

    select * into v_produto
    from produtos
    where id = (v_item ->> 'produto_id')::bigint;

    insert into pedido_itens (pedido_id, produto_id, nome_snapshot, preco_unitario, quantidade)
    values (v_pedido.id, v_produto.id, v_produto.nome, v_produto.preco, v_quantidade);
  end loop;

  return v_pedido;
end;
$$;

comment on function public.criar_pedido(int, jsonb) is 'Único caminho de escrita de pedidos pro cliente (anon). Recalcula o preço no banco, ignorando qualquer valor vindo do navegador.';

-- ========================================================================
-- RPC: pedir_fechamento
-- ========================================================================
-- Se já existir um fechamento pendente pra mesa, retorna o existente em vez de duplicar.

create or replace function public.pedir_fechamento(p_mesa int)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existente  pedidos;
  v_novo       pedidos;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
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

  insert into pedidos (tipo, mesa, total, status)
  values ('fechar_conta', p_mesa, 0, 'pendente')
  returning * into v_novo;

  return v_novo;
end;
$$;

comment on function public.pedir_fechamento(int) is 'Registra o pedido de fechamento de conta da mesa; devolve o existente se já houver um pendente, em vez de duplicar o alerta no balcão.';

-- ========================================================================
-- RPC: conta_da_mesa
-- ========================================================================
-- Itens + total consolidado da mesa, olhando só pedidos 'pendente' ou 'entregue'
-- (nunca 'finalizado' — senão o consumo do cliente anterior apareceria pro próximo).
-- Retorna jsonb: { "itens": [{ "nome", "preco", "quantidade" }, ...], "total": number }

create or replace function public.conta_da_mesa(p_mesa int)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with agrupado as (
    select
      pi.nome_snapshot,
      pi.preco_unitario,
      sum(pi.quantidade)::int as quantidade
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.mesa = p_mesa
      and p.tipo = 'pedido'
      and p.status in ('pendente', 'entregue')
    group by pi.nome_snapshot, pi.preco_unitario
  )
  select jsonb_build_object(
    'itens', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', nome_snapshot, 'preco', preco_unitario, 'quantidade', quantidade)
         order by nome_snapshot
       )
       from agrupado),
      '[]'::jsonb
    ),
    'total', coalesce((select sum(preco_unitario * quantidade) from agrupado), 0)
  );
$$;

comment on function public.conta_da_mesa(int) is 'Itens e total consolidado da mesa (ignora pedidos já finalizados), usado no modal de fechar conta do cliente.';

-- Único caminho de escrita/leitura de pedidos pro cliente (anon): as 3 RPCs acima.
grant execute on function public.criar_pedido(int, jsonb) to anon;
grant execute on function public.pedir_fechamento(int) to anon;
grant execute on function public.conta_da_mesa(int) to anon;

-- ========================================================================
-- SEEDS — mesmos itens, categorias, preços e descrições que hoje estão fixos em script.js
-- ========================================================================

insert into produtos (nome, descricao, preco, categoria, ativo, ordem) values
  -- drinks
  ('Caipirinha',        'Cachaça, limão fresco, açúcar e gelo na medida certa.',        18, 'drink', true, 1),
  ('Moscow Mule',       'Vodka, gengibre, limão e ginger beer geladinha.',              24, 'drink', true, 2),
  ('Gin Tônica',        'Gin premium, tônica artesanal e toque cítrico.',               26, 'drink', true, 3),
  ('Aperol Spritz',     'Aperol, espumante e um splash de água com gás.',               28, 'drink', true, 4),
  ('Negroni',           'Gin, vermute rosso e Campari em partes iguais.',               27, 'drink', true, 5),
  ('Mojito',            'Rum, hortelã fresca, limão, açúcar e água com gás.',           25, 'drink', true, 6),
  ('Piña Colada',       'Rum, leite de coco e abacaxi batido com gelo.',                26, 'drink', true, 7),
  ('Sex on the Beach',  'Vodka, licor de pêssego, suco de laranja e cranberry.',        24, 'drink', true, 8),

  -- cervejas
  ('Heineken Long Neck',    'Lager holandesa, leve e refrescante.',                          13, 'cerveja', true, 1),
  ('Original 600ml',        'Pilsen puro malte, clássica pra dividir com a galera.',         18, 'cerveja', true, 2),
  ('Brahma Duplo Malte',    'Encorpada e cremosa, fácil de tomar.',                          10, 'cerveja', true, 3),
  ('Budweiser Long Neck',   'Lager americana, suave e refrescante.',                         11, 'cerveja', true, 4),
  ('Colorado Indica IPA',   'IPA brasileira com mel, lupulada e amarga.',                    22, 'cerveja', true, 5),
  ('Eisenbahn Weizenbier',  'Weiss brasileira, turva com notas de banana e cravo.',          16, 'cerveja', true, 6),

  -- narguilé
  ('Narguilé Completo',  'Montagem completa com essência à sua escolha.',      45, 'narguile', true, 1),
  ('Troca de Rosh',      'Rosh novo com essência renovada.',                   20, 'narguile', true, 2),
  ('Carvão Extra',       'Porção adicional de carvão natural.',                8,  'narguile', true, 3),
  ('Essência Dupla',     'Mescla de duas essências no mesmo narguilé.',        10, 'narguile', true, 4),

  -- sem álcool
  ('Refrigerante Lata',  'Coca, Guaraná, Fanta ou Sprite gelados.',            7,  'sem_alcool', true, 1),
  ('Suco Natural',       'Feito na hora: laranja, abacaxi ou maracujá.',      12,  'sem_alcool', true, 2),
  ('Água Mineral',       'Com ou sem gás, 500ml gelada.',                     5,  'sem_alcool', true, 3),
  ('Energético',         'Lata gelada, ideal pra acompanhar o narguilé.',     15,  'sem_alcool', true, 4),

  -- essências (sem preço próprio — o custo já está no narguilé; entram no pedido com preço 0)
  ('Menta Ice',          'Refrescante', 0, 'essencia', true, 1),
  ('Melancia',           'Doce',        0, 'essencia', true, 2),
  ('Uva',                'Frutado',     0, 'essencia', true, 3),
  ('Frutas Vermelhas',   'Frutado',     0, 'essencia', true, 4),
  ('Blueberry',          'Doce',        0, 'essencia', true, 5),
  ('Maçã Verde',         'Cítrico',     0, 'essencia', true, 6),
  ('Limão Gelado',       'Cítrico',     0, 'essencia', true, 7),
  ('Duplo Menta',        'Refrescante', 0, 'essencia', true, 8),
  ('Abacaxi',            'Tropical',    0, 'essencia', true, 9),
  ('Tutti-Frutti',       'Doce',        0, 'essencia', true, 10);
