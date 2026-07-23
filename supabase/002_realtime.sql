-- ========================================================================
-- Habilita eventos em tempo real (INSERT/UPDATE) na tabela "pedidos".
--
-- Sem isso, a assinatura Realtime do balcao.js fica "pendurada" sem nunca
-- receber nada — o Postgres precisa ser avisado explicitamente de quais
-- tabelas devem publicar mudanças pro Realtime do Supabase.
--
-- O RLS continua valendo: o balcão (authenticated) só recebe os eventos
-- porque tem a policy de SELECT em "pedidos"; um cliente anônimo não
-- receberia nada mesmo se tentasse se inscrever.
-- ========================================================================

alter publication supabase_realtime add table pedidos;
