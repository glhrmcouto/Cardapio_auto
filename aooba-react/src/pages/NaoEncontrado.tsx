import { Link } from 'react-router-dom';

export default function NaoEncontrado() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
      <div>
        <img src="/img/aooba_bar_fundo_escuro.svg" alt="AOOBA! BAR" style={{ maxWidth: 220, marginBottom: 24 }} />
        <h1 style={{ fontFamily: 'var(--font-heading, inherit)' }}>404 — Página não encontrada</h1>
        <p>O endereço que você abriu não existe.</p>
        <Link to="/" className="btn btn--primary">
          Voltar ao cardápio
        </Link>
      </div>
    </div>
  );
}
