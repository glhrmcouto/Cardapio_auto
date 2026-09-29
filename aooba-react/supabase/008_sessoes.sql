-- ========================================================================
-- AOOBA! BAR — sessão de mesa, identificação do cliente e item compartilhado
-- (migração 008)
-- Pré-requisitos: 001_schema.sql (pedidos/pedido_itens/produtos/mesas via
-- 005_seguranca.sql) e 006_taxa_servico.sql (taxa de serviço).
--
-- Problema que esta migração resolve: hoje "conta_da_mesa" decide o que
-- pertence à comanda atual olhando só pro status (pendente/entregue vs.
-- finalizado). Isso funciona pro caso simples, mas mistura dois conceitos
-- que deveriam ser independentes: status é sobre o preparo do pedido
-- (chegou? foi entregue?), não sobre a qual "rodada de clientes" na mesa
-- ele pertence. A partir daqui, cada grupo de clientes que senta numa mesa
-- abre uma SESSÃO; todo pedido carrega o id da sessão em que foi feito, e
-- é a sessão (não mais o status) que decide o que soma na conta da mesa.
-- Isso também é o que destrava o fechamento individual (item 5): uma
-- pessoa pode "pagar sua parte e sair" sem finalizar pedido nenhum nem
-- encerrar a sessão da mesa pros amigos que ficaram.
-- ========================================================================

-- ========================================================================
-- TABELA: sessoes
-- ========================================================================

create table sessoes (
  id         uuid primary key default gen_random_uuid(),
  mesa       int not null check (mesa > 0),
  aberta_em  timestamptz not null default now(),
  fechada_em timestamptz null,
  status     text not null default 'aberta' check (status in ('aberta', 'fechada'))
);

comment on table sessoes is 'Uma sessão por "rodada" de clientes numa mesa física, do momento em que o primeiro pedido é feito até o fechamento da conta. Todo pedido (pedidos.sessao_id) pertence a exatamente uma sessão.';

create index idx_sessoes_mesa_status on sessoes (mesa, status);

-- Só pode existir UMA sessão aberta por mesa ao mesmo tempo — é essa
-- restrição que garante que criar_pedido sempre saiba, sem ambiguidade,
-- em qual sessão gravar um pedido novo.
create unique index idx_sessoes_mesa_aberta_unica on sessoes (mesa) where status = 'aberta';

alter table sessoes enable row level security;

-- Sem policy pra anon de propósito: o cliente nunca lê "sessoes" direto,
-- só indiretamente através das RPCs (que são SECURITY DEFINER). O balcão
-- (authenticated) precisa enxergar a tabela pra localizar a sessão aberta
-- de uma mesa nas suas próprias consultas.
create policy "sessoes_select_authenticated"
  on sessoes for select
  to authenticated
  using (true);

-- Nenhuma policy de INSERT/UPDATE/DELETE de propósito: a única forma de
-- abrir ou fechar uma sessão é através das RPCs abaixo (criar_pedido,
-- pedir_fechamento, encerrar_sessao), todas SECURITY DEFINER.

-- ========================================================================
-- ALTER: pedidos — sessão + identificação de quem pediu
-- ========================================================================

alter table pedidos add column sessao_id uuid references sessoes (id);
alter table pedidos add column cliente_nome text;
alter table pedidos add column cliente_id uuid;

comment on column pedidos.sessao_id is 'Sessão (rodada de clientes) à qual este pedido pertence. É isso, não mais o status, que separa a conta do grupo atual da de um grupo anterior na mesma mesa.';
comment on column pedidos.cliente_nome is 'Nome/apelido (máx. 20 caracteres) que a pessoa informou no cardápio antes de pedir. Nulo em pedidos anteriores a esta migração.';
comment on column pedidos.cliente_id is 'uuid gerado no navegador da pessoa (sessionStorage), reaproveitado em todos os pedidos dela na mesma visita — é o que permite agrupar "pedidos da Maria" dentro da sessão da mesa pro rateio por pessoa.';

create index idx_pedidos_sessao_id on pedidos (sessao_id);

-- ========================================================================
-- ALTER: pedido_itens — item compartilhado
-- ========================================================================

alter table pedido_itens add column compartilhado boolean not null default false;

comment on column pedido_itens.compartilhado is 'true quando o item (hoje, só narguilé) foi marcado como "dividir entre a mesa": no rateio por pessoa, o valor dele é repartido igualmente entre todo mundo com pedido na sessão, em vez de cobrado só de quem pediu.';

-- ========================================================================
-- BACKFILL — sessões retroativas pros pedidos em aberto que já existiam
-- antes desta migração (senão eles ficam com sessao_id nulo e desaparecem
-- da conta_da_mesa, que passa a filtrar por sessão em vez de status).
-- ========================================================================

insert into sessoes (mesa, aberta_em)
select mesa, min(criado_em)
from pedidos
where tipo = 'pedido' and status in ('pendente', 'entregue') and sessao_id is null
group by mesa
on conflict (mesa) where status = 'aberta' do nothing;

update pedidos p
set sessao_id = s.id
from sessoes s
where s.mesa = p.mesa and s.status = 'aberta'
  and p.tipo = 'pedido' and p.status in ('pendente', 'entregue') and p.sessao_id is null;

update pedidos p
set sessao_id = s.id
from sessoes s
where s.mesa = p.mesa and s.status = 'aberta'
  and p.tipo = 'fechar_conta' and p.status = 'pendente' and p.sessao_id is null;

-- ========================================================================
-- TABELA: fechamentos_individuais
-- ========================================================================
-- Registro do "fechar só a minha conta" (item 5): não mexe em pedidos nem
-- na sessão da mesa, só documenta que aquela pessoa já acertou a parte
-- dela e avisa o balcão. "atendido" marca quando o garçom confirma que
-- recebeu o pagamento.

create table fechamentos_individuais (
  id           uuid primary key default gen_random_uuid(),
  sessao_id    uuid not null references sessoes (id),
  mesa         int not null check (mesa > 0),
  cliente_id   uuid not null,
  cliente_nome text not null,
  subtotal     numeric(10, 2) not null check (subtotal >= 0),
  taxa_servico numeric(10, 2) not null check (taxa_servico >= 0),
  total        numeric(10, 2) not null check (total >= 0),
  criado_em    timestamptz not null default now(),
  atendido     boolean not null default false,
  atendido_em  timestamptz null
);

comment on table fechamentos_individuais is 'Fechamento parcial de uma pessoa dentro de uma sessão de mesa ainda aberta (ver RPC fechar_conta_individual). Não finaliza pedidos nem fecha a sessão — é só o aviso/recibo pro balcão de que essa pessoa já pagou a parte dela.';

create index idx_fechamentos_individuais_atendido on fechamentos_individuais (atendido);

alter table fechamentos_individuais enable row level security;

create policy "fechamentos_individuais_select_authenticated"
  on fechamentos_individuais for select
  to authenticated
  using (true);

-- O balcão marca "atendido" direto (update simples), sem precisar de RPC —
-- mesmo padrão de "pedidos_update_authenticated" em 001_schema.sql.
create policy "fechamentos_individuais_update_authenticated"
  on fechamentos_individuais for update
  to authenticated
  using (true)
  with check (true);

-- Sem policy de INSERT pra anon nem authenticated de propósito: o único
-- jeito de criar um registro é a RPC fechar_conta_individual (SECURITY
-- DEFINER), que exige o token da mesa antes de gravar qualquer coisa.

alter publication supabase_realtime add table fechamentos_individuais;

-- ========================================================================
-- RPC: criar_pedido (substitui a versão de 005_seguranca.sql)
-- ========================================================================
-- Ganha p_cliente_nome/p_cliente_id (identificação de quem pediu) e cada
-- item do array agora pode trazer "compartilhado": true/false. Também
-- passa a buscar (ou abrir, se não houver) a sessão aberta da mesa e
-- gravar o pedido já vinculado a ela.

drop function if exists public.criar_pedido(int, text, jsonb);

create or replace function public.criar_pedido(
  p_mesa         int,
  p_token        text,
  p_itens        jsonb,
  p_cliente_nome text,
  p_cliente_id   uuid
)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido            pedidos;
  v_mesa              mesas;
  v_sessao_id         uuid;
  v_pedidos_recentes  int;
  v_total             numeric(10, 2) := 0;
  v_total_itens       int := 0;
  v_item              jsonb;
  v_produto           produtos;
  v_quantidade        int;
  v_compartilhado     boolean;
  v_nome_limpo        text;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível registrar seu pedido. Verifique o QR code da mesa.';
  end if;

  -- Nome é obrigatório (não dá pra ratear item compartilhado nem mostrar
  -- "quem pediu" no balcão sem ele) — validado de novo aqui mesmo já
  -- existindo validação no navegador, porque o navegador não é confiável.
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

  -- Limite de frequência: no máximo 5 pedidos por mesa a cada 2 minutos
  -- (mesma regra de 005_seguranca.sql).
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

  -- Sessão aberta da mesa: reaproveita se já existir; senão abre uma nova
  -- na hora. O "on conflict" mira o índice único parcial
  -- idx_sessoes_mesa_aberta_unica, então dois pedidos quase simultâneos
  -- pra uma mesa sem sessão ainda não abrem duas sessões em paralelo.
  insert into sessoes (mesa) values (p_mesa)
  on conflict (mesa) where status = 'aberta' do nothing;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;

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
    values (v_pedido.id, v_produto.id, v_produto.nome, v_produto.preco, v_quantidade, v_compartilhado);
  end loop;

  return v_pedido;
end;
$$;

comment on function public.criar_pedido(int, text, jsonb, text, uuid) is 'Único caminho de escrita de pedidos pro cliente (anon). Exige token da mesa e nome do cliente, vincula o pedido à sessão aberta da mesa (abrindo uma nova se preciso) e recalcula o preço no banco, ignorando qualquer valor vindo do navegador.';

grant execute on function public.criar_pedido(int, text, jsonb, text, uuid) to anon;

-- ========================================================================
-- RPC: pedir_fechamento (substitui a versão de 005_seguranca.sql)
-- ========================================================================
-- Mesma assinatura de antes — só passa a vincular a solicitação à sessão
-- aberta da mesa (abrindo uma, no caso raro de pedir fechamento sem nunca
-- ter feito um pedido antes).

create or replace function public.pedir_fechamento(p_mesa int, p_token text)
returns pedidos
language plpgsql
security definer
set search_path = public
as $$
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

  insert into sessoes (mesa) values (p_mesa)
  on conflict (mesa) where status = 'aberta' do nothing;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;

  insert into pedidos (tipo, mesa, total, status, sessao_id)
  values ('fechar_conta', p_mesa, 0, 'pendente', v_sessao_id)
  returning * into v_novo;

  return v_novo;
end;
$$;

comment on function public.pedir_fechamento(int, text) is 'Registra o pedido de fechamento de conta da mesa (exige token da mesa), vinculado à sessão aberta; devolve o existente se já houver um pendente, em vez de duplicar o alerta no balcão.';

grant execute on function public.pedir_fechamento(int, text) to anon;

-- ========================================================================
-- RPC: conta_da_mesa (substitui a versão de 007_token_conta_mesa.sql)
-- ========================================================================
-- Mesma assinatura de antes. Muda só a fonte dos itens: agora é a sessão
-- aberta da mesa (sessao_id), não mais o status dos pedidos — é isso que
-- garante que a conta de um grupo anterior (sessão já fechada) nunca
-- apareça pro grupo atual, mesmo em corner cases onde o status de algum
-- pedido antigo não tenha sido atualizado corretamente.

create or replace function public.conta_da_mesa(p_mesa int, p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_mesa      mesas;
  v_sessao_id uuid;
  v_resultado jsonb;
begin
  select * into v_mesa from mesas where numero = p_mesa and ativa = true;
  if not found or v_mesa.token is distinct from p_token then
    raise exception 'Não foi possível consultar sua conta. Verifique o QR code da mesa.';
  end if;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta';

  with agrupado as (
    select
      pi.nome_snapshot,
      pi.preco_unitario,
      sum(pi.quantidade)::int as quantidade
    from pedido_itens pi
    join pedidos p on p.id = pi.pedido_id
    where p.sessao_id = v_sessao_id
      and p.tipo = 'pedido'
    group by pi.nome_snapshot, pi.preco_unitario
  ),
  totais as (
    select coalesce(sum(preco_unitario * quantidade), 0)::numeric(10, 2) as subtotal
    from agrupado
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
    'subtotal', totais.subtotal,
    'taxa_servico', round(totais.subtotal * 0.10, 2),
    'total', totais.subtotal + round(totais.subtotal * 0.10, 2)
  )
  into v_resultado
  from totais;

  return v_resultado;
end;
$$;

comment on function public.conta_da_mesa(int, text) is 'Itens, subtotal, taxa de serviço (10%) e total da SESSÃO ABERTA da mesa (não mais por status). Exige o token da mesa. Usado no modal de fechar conta do cliente.';

grant execute on function public.conta_da_mesa(int, text) to anon;

-- ========================================================================
-- RPC: encerrar_sessao
-- ========================================================================
-- Fecha a sessão aberta da mesa inteira: marca a sessão como 'fechada' e
-- todos os pedidos dela (tipo 'pedido' ou 'fechar_conta', pendentes ou
-- entregues) como 'finalizado'. É o que o botão "Conta Fechada" do balcão
-- chama, substituindo os dois updates manuais que ele fazia antes.

create or replace function public.encerrar_sessao(p_mesa int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessao_id uuid;
begin
  if p_mesa is null or p_mesa <= 0 then
    raise exception 'Número da mesa inválido.';
  end if;

  select id into v_sessao_id from sessoes where mesa = p_mesa and status = 'aberta' limit 1;

  if not found then
    raise exception 'Não há sessão aberta para a mesa %.', p_mesa;
  end if;

  update pedidos
  set status = 'finalizado'
  where sessao_id = v_sessao_id
    and status in ('pendente', 'entregue');

  update sessoes
  set status = 'fechada', fechada_em = now()
  where id = v_sessao_id;
end;
$$;

comment on function public.encerrar_sessao(int) is 'Fecha a sessão aberta da mesa: marca a sessão como fechada e todos os seus pedidos pendentes/entregues como finalizado. Chamada pelo botão "Conta Fechada" do balcão (qualquer authenticated, mesmo padrão de pedidos_update_authenticated).';

revoke all on function public.encerrar_sessao(int) from public;
grant execute on function public.encerrar_sessao(int) to authenticated;

-- ========================================================================
-- RPC: conta_da_mesa_balcao
-- ========================================================================
-- Equivalente a conta_da_mesa, mas pro uso interno do balcão (authenticated,
-- sem token — o balcão já é uma tela logada) e com o subtotal por pessoa,
-- já aplicando o rateio dos itens compartilhados entre todos com pedido
-- na sessão. Usada no card de alerta de "fechar conta".
--
-- Observação: se o número de pessoas não dividir os itens compartilhados
-- de forma exata, a soma dos subtotais por pessoa pode ter um arredondamento
-- de poucos centavos em relação ao subtotal total — aceitável pra exibição,
-- não afeta o total real cobrado da mesa (que vem de "subtotal"/"total").

create or replace function public.conta_da_mesa_balcao(p_mesa int)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with sessao as (
    select id from sessoes where mesa = p_mesa and status = 'aberta'
  ),
  pedidos_sessao as (
    select p.id, p.cliente_id, coalesce(nullif(trim(p.cliente_nome), ''), 'Sem nome') as cliente_nome
    from pedidos p
    where p.tipo = 'pedido' and p.sessao_id = (select id from sessao)
  ),
  pessoas as (
    select distinct cliente_id, cliente_nome from pedidos_sessao
  ),
  n_pessoas as (
    select greatest(count(*), 1)::int as n from pessoas
  ),
  itens_detalhe as (
    select
      pi.nome_snapshot,
      pi.preco_unitario,
      pi.quantidade,
      pi.compartilhado,
      ps.cliente_id,
      (pi.preco_unitario * pi.quantidade)::numeric(10, 2) as valor_item
    from pedido_itens pi
    join pedidos_sessao ps on ps.id = pi.pedido_id
  ),
  agrupado as (
    select nome_snapshot, preco_unitario, sum(quantidade)::int as quantidade
    from itens_detalhe
    group by nome_snapshot, preco_unitario
  ),
  totais as (
    select coalesce(sum(valor_item), 0)::numeric(10, 2) as subtotal from itens_detalhe
  ),
  compartilhado_total as (
    select coalesce(sum(valor_item), 0)::numeric(10, 2) as total from itens_detalhe where compartilhado
  ),
  por_pessoa as (
    select
      pe.cliente_nome,
      (
        coalesce((
          select sum(id2.valor_item) from itens_detalhe id2
          where id2.compartilhado = false and id2.cliente_id is not distinct from pe.cliente_id
        ), 0)
        + (select total from compartilhado_total) / (select n from n_pessoas)
      )::numeric(10, 2) as subtotal
    from pessoas pe
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
    'subtotal', (select subtotal from totais),
    'taxa_servico', round((select subtotal from totais) * 0.10, 2),
    'total', (select subtotal from totais) + round((select subtotal from totais) * 0.10, 2),
    'por_pessoa', coalesce(
      (select jsonb_agg(
         jsonb_build_object('nome', cliente_nome, 'subtotal', subtotal)
         order by cliente_nome
       )
       from por_pessoa),
      '[]'::jsonb
    )
  );
$$;

comment on function public.conta_da_mesa_balcao(int) is 'Itens, subtotal, taxa de serviço, total e subtotal por pessoa (com rateio de itens compartilhados) da sessão aberta da mesa. Uso interno do balcão — sem token, qualquer authenticated pode chamar.';

revoke all on function public.conta_da_mesa_balcao(int) from public;
grant execute on function public.conta_da_mesa_balcao(int) to authenticated;

-- ========================================================================
-- RPC: fechar_conta_individual
-- ========================================================================
-- "Fechar só a minha conta" (item 5): calcula o quanto aquela pessoa deve
-- (itens dela + rateio dos compartilhados da sessão) e grava um registro
-- em fechamentos_individuais pro balcão ver e confirmar o recebimento.
-- NÃO finaliza pedidos nem fecha a sessão da mesa — quem ficar continua
-- pedindo normalmente.

create or replace function public.fechar_conta_individual(p_mesa int, p_token text, p_cliente_id uuid)
returns fechamentos_individuais
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa                    mesas;
  v_sessao_id                uuid;
  v_cliente_nome              text;
  v_subtotal_direto           numeric(10, 2);
  v_subtotal_compartilhado    numeric(10, 2);
  v_n_pessoas                 int;
  v_subtotal                  numeric(10, 2);
  v_taxa                      numeric(10, 2);
  v_registro                  fechamentos_individuais;
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

  select coalesce(nullif(trim(cliente_nome), ''), 'Sem nome') into v_cliente_nome
  from pedidos
  where sessao_id = v_sessao_id and tipo = 'pedido' and cliente_id = p_cliente_id
  order by criado_em desc
  limit 1;

  if not found then
    raise exception 'Não encontramos pedidos seus nessa mesa.';
  end if;

  select greatest(count(distinct cliente_id), 1) into v_n_pessoas
  from pedidos
  where sessao_id = v_sessao_id and tipo = 'pedido';

  select coalesce(sum(pi.preco_unitario * pi.quantidade), 0) into v_subtotal_direto
  from pedido_itens pi
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and p.tipo = 'pedido' and p.cliente_id = p_cliente_id
    and pi.compartilhado = false;

  select coalesce(sum(pi.preco_unitario * pi.quantidade), 0) into v_subtotal_compartilhado
  from pedido_itens pi
  join pedidos p on p.id = pi.pedido_id
  where p.sessao_id = v_sessao_id and p.tipo = 'pedido'
    and pi.compartilhado = true;

  v_subtotal := (v_subtotal_direto + (v_subtotal_compartilhado / v_n_pessoas))::numeric(10, 2);
  v_taxa := round(v_subtotal * 0.10, 2);

  insert into fechamentos_individuais (sessao_id, mesa, cliente_id, cliente_nome, subtotal, taxa_servico, total)
  values (v_sessao_id, p_mesa, p_cliente_id, v_cliente_nome, v_subtotal, v_taxa, v_subtotal + v_taxa)
  returning * into v_registro;

  return v_registro;
end;
$$;

comment on function public.fechar_conta_individual(int, text, uuid) is 'Fechamento parcial de uma pessoa (item 5): calcula o subtotal dela (itens próprios + rateio dos compartilhados da sessão) e grava um aviso pro balcão em fechamentos_individuais, sem mexer em pedidos nem na sessão da mesa.';

grant execute on function public.fechar_conta_individual(int, text, uuid) to anon;
