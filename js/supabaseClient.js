// ========================================================================
// Cliente único do Supabase — importado tanto pelo cardápio (script.js)
// quanto pelo balcão (balcao.js).
//
// A "publishable key" abaixo é PÚBLICA POR DESIGN: ela vai pro navegador de
// qualquer pessoa que abrir a página, é só um identificador do projeto,
// equivalente à antiga "anon key". Ela sozinha não dá acesso a nada — a
// proteção real é o Row Level Security (RLS) configurado no banco (ver
// supabase/001_schema.sql): "produtos" só é legível quando ativo = true, e
// "pedidos"/"pedido_itens" não podem ser lidos nem gravados direto por
// ninguém anônimo — só através das funções RPC (criar_pedido,
// pedir_fechamento, conta_da_mesa) ou por um usuário autenticado (a tela
// do balcão, depois de login).
//
// NUNCA coloque aqui a service_role/secret key: ela dá acesso total ao
// banco ignorando o RLS e não pode existir em código que roda no navegador.
// ========================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8';

const SUPABASE_URL = 'https://ucsjnlynjsfbwripteuo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_LXWrv90MTy68XlK1MRO7yg_RzKh4ny8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);