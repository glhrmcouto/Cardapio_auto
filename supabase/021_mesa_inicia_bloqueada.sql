-- ========================================================================
-- AOOBA! BAR — mesa nasce bloqueada, exige liberação antes do 1º pedido (migração 021)
-- Rodar no SQL Editor do painel do Supabase, no projeto do cardápio.
-- Pré-requisito: 019_bloqueio_mesa.sql (coluna status_mesa, liberar_mesa,
-- status_da_mesa, painel "Controle de Mesas" em balcao.html).
--
-- PROBLEMA: 019 fez a mesa bloquear sozinha DEPOIS de um fechamento total,
-- mas o DEFAULT da coluna continuava 'liberada' — então uma mesa RECÉM
-- CRIADA (criar_mesa via admin.html/mesas.html, INSERT simples com só
-- "numero") nascia liberada, sem passar pela confirmação do garçom. Isso
-- deixa a mesma brecha que 019 fechou pro pós-fechamento: se o QR de uma
-- mesa nova vazar/for adivinhado antes de ela receber gente de verdade,
-- qualquer um abre sessão nela.
--
-- SOLUÇÃO: muda o DEFAULT de status_mesa pra 'bloqueada' — toda mesa nova
-- passa a exigir o mesmo "garçom confirma presença e libera" que já existia
-- pro pós-fechamento (liberar_mesa, painel "Controle de Mesas"). Nenhuma
-- outra RPC muda: criar_mesa é um INSERT direto (admin/mesas.html), então
-- basta o DEFAULT novo pra ele nascer bloqueado sozinho.
--
-- DECISÃO SOBRE AS MESAS JÁ EXISTENTES (não é retroativo por acidente —
-- é intencional): a regra nova é "mesa começa bloqueada, sempre". Deixar as
-- mesas já cadastradas em 'liberada' criaria duas classes de mesa
-- inconsistentes (as antigas nunca exigem liberação inicial, só as novas
-- exigem) e manteria a mesma brecha nelas. Por isso este script também
-- BLOQUEIA todas as mesas existentes agora — o bar passa a exigir liberação
-- de TODAS antes do próximo pedido, sem exceção. Isso é intencional e
-- esperado: depois de rodar esta migração, todo garçom/balcão vai precisar
-- liberar cada mesa (painel "Controle de Mesas" em balcao.html) antes que
-- o primeiro cliente do dia consiga pedir nela.
-- ========================================================================

-- ========================================================================
-- DEFAULT: mesas.status_mesa
-- ========================================================================
alter table mesas
  alter column status_mesa set default 'bloqueada';

comment on column mesas.status_mesa is 'Se a mesa aceita abrir sessão/pedido AGORA. Nasce ''bloqueada'' (ver 021_mesa_inicia_bloqueada.sql) e também fica ''bloqueada'' depois de um fechamento total, até um garçom confirmar presença e liberar de novo (ver liberar_mesa). Independente de "ativa" (mesa existir no sistema).';

-- ========================================================================
-- MESAS JÁ EXISTENTES: aplica a regra nova retroativamente, de propósito
-- ========================================================================
-- Idempotente — rodar de novo não tem efeito colateral (mesa já bloqueada
-- continua bloqueada). Ver DECISÃO no comentário do topo do arquivo.

update mesas set status_mesa = 'bloqueada';
