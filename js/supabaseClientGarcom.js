// ========================================================================
// Cliente do Supabase EXCLUSIVO da tela do garçom (garcom.html).
// ========================================================================
//
// PROBLEMA que este arquivo resolve: js/supabaseClient.js (o cliente
// "principal", importado por admin.js/balcao.js/mesas.js/relatorios.js/
// script.js/gerar-qrcodes.js) guarda a sessão de login no localStorage do
// navegador com a chave padrão do supabase-js — que é a MESMA pro
// navegador inteiro, não uma por página. Como só existe UMA sessão por
// chave, logar como admin/balcão numa aba e como garçom em outra (mesmo
// navegador) faz um login sobrescrever o outro — quem logou por último
// "ganha" em todas as abas, e a conta anterior cai sozinha. É exatamente
// esse o sintoma de "não consegue ficar logado nas duas telas ao mesmo
// tempo".
//
// SOLUÇÃO: um client separado, com "storageKey" diferente — assim a sessão
// do garçom fica guardada numa chave própria do localStorage, independente
// da sessão usada por admin/balcão/mesas/relatórios. As duas contas podem
// ficar logadas ao mesmo tempo, cada uma na sua tela, no mesmo navegador.
// Mesma URL/chave pública do projeto (não é outro projeto Supabase, só
// outra "gaveta" de sessão) — ver comentário de segurança completo em
// js/supabaseClient.js.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8';

const SUPABASE_URL = 'https://ucsjnlynjsfbwripteuo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_LXWrv90MTy68XlK1MRO7yg_RzKh4ny8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: 'sb-garcom-auth-token',
  },
});
