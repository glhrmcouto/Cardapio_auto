-- ========================================================================
-- AOOBA! BAR — Realtime na tabela "sessoes" (migração 012)
-- ========================================================================
-- O novo painel "Mesas Ativas" do balcão (balcao.js) precisa saber na hora
-- quando uma mesa abre uma sessão nova (primeiro pedido) ou fecha uma
-- existente (encerrar_sessao), sem precisar recarregar a página — mesmo
-- motivo de 002_realtime.sql (pedidos) e do trecho de 009 que fez o mesmo
-- pra "pagamentos".
--
-- O RLS de "sessoes" (ver 008_sessoes.sql) já libera SELECT pra qualquer
-- authenticated, então o balcão recebe esses eventos sem precisar de nada
-- além disso; um cliente anônimo não teria a mesma sorte, já que não tem
-- policy nenhuma na tabela.

alter publication supabase_realtime add table sessoes;
