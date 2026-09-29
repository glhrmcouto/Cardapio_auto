import { useEffect, type ReactNode } from 'react';

interface Props {
  aberto: boolean;
  onFechar?: () => void;
  titulo: ReactNode;
  /** Modificador de classe do painel (ex.: modal-panel--historico). */
  variante?: string;
  /** Mostra o X no header. */
  comFechar?: boolean;
  /** Clique no overlay fecha? (padrão: sim quando há onFechar). */
  fecharNoOverlay?: boolean;
  children: ReactNode;
}

/** Overlay + painel com as classes .modal-overlay/.modal-panel do base.css. */
export function Modal({ aberto, onFechar, titulo, variante, comFechar = true, fecharNoOverlay = true, children }: Props) {
  useEffect(() => {
    if (!aberto || !onFechar) return;
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    document.addEventListener('keydown', aoTecla);
    return () => document.removeEventListener('keydown', aoTecla);
  }, [aberto, onFechar]);

  return (
    <>
      <div className={`modal-overlay${aberto ? ' is-open' : ''}`} onClick={fecharNoOverlay ? onFechar : undefined} />
      <div className={`modal-panel${variante ? ` ${variante}` : ''}${aberto ? ' is-open' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-panel__header">
          <span className="modal-panel__title">{titulo}</span>
          {comFechar && onFechar && (
            <button className="modal-panel__close" aria-label="Fechar" onClick={onFechar}>
              &times;
            </button>
          )}
        </div>
        {children}
      </div>
    </>
  );
}
