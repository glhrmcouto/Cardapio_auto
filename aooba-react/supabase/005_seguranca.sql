-- ========================================================================
-- AOOBA! BAR — token por mesa + limites de abuso (migração 005)
-- Pré-requisitos: 001_schema.sql (pedidos/pedido_itens/produtos, extensão
-- pgcrypto) e 003_admin.sql (perfis + eh_admin()). Também reaproveita
-- public._exigir_admin() de 004_relatorios.sql.
--
-- Problema que esta migração resolve: hoje qualquer pessoa com a URL do
-- cardápio pode digitar QUALQUER número de mesa e mandar um pedido "de
-- verdade" pra ela — o site é público e criar_pedido/pedir_fechamento só
-- validavam o número da mesa, nunca se quem está pedindo é de fato quem
-- está sentado ali. A partir daqui, cada mesa tem um token secreto (só
-- conhecido por quem escaneou o QR code físico dela) e as duas RPCs
-- passam a exigir esse token pra aceitar qualquer coisa.
-- ========================================================================

-- ========================================================================
-- TABELA: mesas
-- ========================================================================
-- token nasce aleatório (16 bytes = 128 bits, via pgcrypto — já habilitado
-- em 001_schema.sql, mesma extensão usada em pedidos.id) e nunca é gerado
-- pelo navegador: ou vem do DEFAULT no INSERT, ou da RPC
-- regenerar_token_mesa() abaixo.

create table mesas (
  numero  int primary key check (numero > 0),
  token   text not null unique default encode(gen_random_bytes(16), 'hex'),
  ativa   boolean not null default true
);

comment on table mesas is 'Uma linha por mesa física. O token é o segredo que vai no QR code (?mesa=N&t=TOKEN) e autoriza criar_pedido/pedir_fechamento pra essa mesa.';

alter table mesas enable row level security;

-- Só admin enxerga/mexe na lista de mesas (o token é secreto — anon não tem
-- NENHUMA policy aqui de propósito, então RLS barra qualquer leitura direta
-- da tabela por quem não for authenticated+admin). criar_pedido/pedir_fechamento
-- continuam funcionando pra anon porque são SECURITY DEFINER e ignoram RLS.
create policy "mesas_select_admin"
  on mesas for select
  to authenticated
  using (public.eh_admin());

create policy "mesas_insert_admin"
  on mesas for insert
  to authenticated
  with check (public.eh_admin());

create policy "mesas_update_admin"
  on mesas for update
  to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- Sem policy de DELETE de propósito: pra tirar uma mesa de circulação, o
-- admin.html desativa (ativa = false) em vez de excluir — mantém o token
-- histórico rastreável e evita reaproveitar um número de mesa por engano.

-- ========================================================================
-- SEED — ajuste a faixa de números pro tanto de mesas que o bar tem hoje
-- e rode só isso uma vez (rodar de novo pula os números que já existem,
-- graças ao "on conflict do nothing")
-- ========================================================================

insert into mesas (numero)
select gerar.numero
from generate_series(1, 20) as gerar(numero)
on conflict (numero) do nothing;

-- ========================================================================
-- RPC: criar_pedido (substitui a versão de 001_schema.sql — agora exige token)
-- ========================================================================
-- "drop" é necessário porque adicionar p_token muda a assinatura da função;
-- um "create or replace" com parâmetros diferentes criaria uma SEGUNDA
-- função em vez de substituir, deixando a versão antiga (sem token) ainda
-- executável por anon.

drop function if exists public.criar_pedido(int, jsonb);

create or replace function public.criar_pedido(p_mesa int, p_token text, p_itens jsonb)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido            pedidos;
  v_mesa               mesas;
  v_pedidos_recentes   int;
  v_total              numeric(10, 2) := 0;
  v_total_itens        int := 0;
  v_item               jsonb;
  v_produto            produtos;
  v_quantidade         int;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  -- Mesa precisa existir, estar ativa E o token precisa bater — qualquer uma
  -- dessas três falhas cai na MESMA mensagem genérica, de propósito (não dá
  -- pra quem está tentando abusar saber se errou o token, se a mesa está
  -- desativada ou se o número nem existe).
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  -- Limite de frequência: no máximo 5 pedidos por mesa a cada 2 minutos.
  -- (checagem simples por contagem — não é perfeitamente atômica sob
  -- concorrência pesada, mas é o suficiente pra frear abuso automatizado
  -- sem complicar a função com locks.)
  select count(*) into v_pedidos_recentes
  from pedidos
  where mesa = p_mesa
    and tipo = 'pedido'
    and criado_em > now() - interval '2 minutes';

  if v_pedidos_recentes >= 5 then
    raise exception 'Aguarde um instante antes de fazer outro pedido.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  -- 1ª passada: valida TODOS os itens, soma a quantidade total e calcula o
  -- total em dinheiro antes de gravar qualquer coisa (item inválido no meio
  -- da lista não deixa o pedido gravado pela metade).
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

comment on function public.criar_pedido(int, text, jsonb) is 'Único caminho de escrita de pedidos pro cliente (anon). Exige o token da mesa, limita 5 pedidos/2min por mesa e 40 itens por pedido. Recalcula o preço no banco, ignorando qualquer valor vindo do navegador.';

grant execute on function public.criar_pedido(int, text, jsonb) to anon;

-- ========================================================================
-- RPC: pedir_fechamento (substitui a versão de 001_schema.sql — agora exige token)
-- ========================================================================

drop function if exists public.pedir_fechamento(int);

create or replace function public.pedir_fechamento(p_mesa int, p_token text)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa       mesas;
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

comment on function public.pedir_fechamento(int, text) is 'Registra o pedido de fechamento de conta da mesa (exige o token da mesa); devolve o existente se já houver um pendente, em vez de duplicar o alerta no balcão.';

grant execute on function public.pedir_fechamento(int, text) to anon;

-- ========================================================================
-- RPC: regenerar_token_mesa
-- ========================================================================
-- Pra quando um adesivo de QR code é roubado/fotografado/vazado: gera um
-- token novo pra mesa (o QR antigo, impresso, para de funcionar na hora —
-- é só reimprimir com o link novo, disponível no admin.html ou via
-- gerar-qrcodes.html).

create or replace function public.regenerar_token_mesa(p_numero int)
returns mesas
language plpgsql
security definer
set search_path = public
as $$
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

comment on function public.regenerar_token_mesa(int) is 'Gera um token novo pra mesa (invalida o QR code antigo). Restrito a admin.';

revoke all on function public.regenerar_token_mesa(int) from public;
grant execute on function public.regenerar_token_mesa(int) to authenticated;

-- ========================================================================
-- SELECT — lista de mesas com a URL completa (referência manual — o
-- gerar-qrcodes.html normal já busca isso sozinho direto do Supabase,
-- login de admin; isso aqui é só um jeito alternativo de conferir/exportar
-- pelo SQL Editor, se precisar).
-- ========================================================================

-- Versão pra conferir a olho (número, status, link):
select
  numero,
  ativa,
  'https://aooba.netlify.app/index.html?mesa=' || numero || '&t=' || token as url
from mesas
order by numero;

-- Versão em "numero,url" (uma linha por mesa, sem cabeçalho):
select
  numero || ',' || 'https://aooba.netlify.app/index.html?mesa=' || numero || '&t=' || token as linha
from mesas
where ativa = true
order by numero;
