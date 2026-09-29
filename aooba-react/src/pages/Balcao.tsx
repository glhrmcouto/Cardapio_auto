import { useEffect } from 'react';
import { RequireAuth } from '../auth/RequireAuth';
import { BalcaoConteudo } from './balcao/BalcaoConteudo';
import { supabase } from '../lib/supabase';
import '../styles/balcao.css';

export default function Balcao() {
  useEffect(() => {
    document.title = 'AOOBA! — Balcão';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  return (
    <RequireAuth cliente={supabase} titulo="Balcão" papeis={null}>
      {({ sair }) => <BalcaoConteudo sair={sair} />}
    </RequireAuth>
  );
}
