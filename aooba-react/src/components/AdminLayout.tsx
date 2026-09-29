import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import { supabase } from '../lib/supabase';
import '../styles/admin.css';

type Destino = 'admin' | 'mesas' | 'relatorios' | 'gerar-qrcodes';

const LINKS: { destino: Destino; to: string; label: string }[] = [
  { destino: 'admin', to: '/admin', label: 'Cardápio' },
  { destino: 'mesas', to: '/mesas', label: 'Mesas' },
  { destino: 'relatorios', to: '/relatorios', label: 'Relatórios' },
  { destino: 'gerar-qrcodes', to: '/gerar-qrcodes', label: 'QR codes' },
];

interface Props {
  /** Página atual (não aparece nos links). */
  atual: Destino;
  /** Texto do login e da tag do header. */
  titulo: string;
  docTitle: string;
  children: ReactNode;
}

/** Login (papel admin) + header comum das telas do dono. */
export function AdminLayout({ atual, titulo, docTitle, children }: Props) {
  useEffect(() => {
    document.title = docTitle;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [docTitle]);

  return (
    <RequireAuth cliente={supabase} titulo={titulo} papeis={['admin']}>
      {({ sair }) => (
        <div>
          <header className="header admin-header">
            <nav className="nav container">
              <span className="nav__logo">
                AOOBA! <span className="admin-header__tag">— {titulo}</span>
              </span>
              <div className="admin-header__acoes">
                {LINKS.filter((l) => l.destino !== atual).map((l) => (
                  <Link key={l.destino} className="btn btn--secondary admin-header__sair" to={l.to}>
                    {l.label}
                  </Link>
                ))}
                <button className="btn btn--secondary admin-header__sair" onClick={sair}>
                  Sair
                </button>
              </div>
            </nav>
          </header>
          <main className="admin-main container">{children}</main>
        </div>
      )}
    </RequireAuth>
  );
}
