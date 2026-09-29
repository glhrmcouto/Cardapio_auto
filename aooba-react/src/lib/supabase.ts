import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// A chave publicável é pública por design: quem protege os dados é o RLS.
// NUNCA colocar a service_role aqui.
export const supabase = createClient(url, key);

// Cliente exclusivo do garçom: storageKey própria para manter a sessão
// independente da de admin/balcão no mesmo navegador.
export const supabaseGarcom = createClient(url, key, {
  auth: { storageKey: 'sb-garcom-auth-token' },
});
