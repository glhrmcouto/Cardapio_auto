import { Modal } from '../../components/Modal';
import type { ControleMesas } from '../../hooks/useControleMesas';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  controle: ControleMesas;
  mesasComSessao: Set<string>;
}

export function ControleMesasModal({ aberto, onFechar, controle, mesasComSessao }: Props) {
  const { mesas, ocupado } = controle;

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Controle de Mesas" variante="modal-panel--controle-mesas">
      <div className="controle-mesas-massa">
        <button type="button" className="btn btn--secondary" disabled={ocupado === 'liberar-todas'} onClick={() => void controle.liberarTodas()}>
          Liberar todas
        </button>
        <button type="button" className="btn btn--secondary" disabled={ocupado === 'bloquear-todas'} onClick={() => void controle.bloquearTodas()}>
          Bloquear todas
        </button>
      </div>
      {mesas.length === 0 && <p className="modal-panel__vazio">Nenhuma mesa cadastrada.</p>}
      <div className="controle-mesas-grid">
        {mesas.map((mesa) => {
          if (!mesa.ativa) {
            return (
              <div key={mesa.numero} className="controle-mesa-card controle-mesa-card--inativa">
                <div className="controle-mesa-card__mesa">Mesa {mesa.numero}</div>
                <span className="controle-mesa-card__status controle-mesa-card__status--inativa">Inativa</span>
                <button type="button" className="btn btn--secondary controle-mesa-card__ativar" disabled={ocupado === `ativar-${mesa.numero}`} onClick={() => void controle.ativar(mesa.numero)}>
                  {ocupado === `ativar-${mesa.numero}` ? 'Ativando...' : 'Ativar mesa'}
                </button>
              </div>
            );
          }
          const bloqueada = mesa.status_mesa === 'bloqueada';
          return (
            <div key={mesa.numero} className={`controle-mesa-card${bloqueada ? ' controle-mesa-card--bloqueada' : ''}`}>
              <div className="controle-mesa-card__mesa">Mesa {mesa.numero}</div>
              <span className={`controle-mesa-card__status controle-mesa-card__status--${mesa.status_mesa}`}>{bloqueada ? 'Bloqueada' : 'Liberada'}</span>
              {mesasComSessao.has(String(mesa.numero)) && <span className="controle-mesa-card__sessao">Sessão aberta</span>}
              {bloqueada && (
                <button type="button" className="btn btn--primary controle-mesa-card__liberar" disabled={ocupado === `liberar-${mesa.numero}`} onClick={() => void controle.liberar(mesa.numero)}>
                  {ocupado === `liberar-${mesa.numero}` ? 'Liberando...' : 'Liberar mesa'}
                </button>
              )}
              <button type="button" className="btn btn--secondary controle-mesa-card__desativar" disabled={ocupado === `desativar-${mesa.numero}`} onClick={() => void controle.desativar(mesa.numero)}>
                {ocupado === `desativar-${mesa.numero}` ? 'Desativando...' : 'Desativar'}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
