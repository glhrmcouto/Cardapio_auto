import { useEffect, useState } from 'react';

interface Props {
  aberto: boolean;
  nomeAtual: string;
  onConfirmar: (nome: string) => void;
  onCancelar: () => void;
}

/** Sem nome ainda: obrigatório (sem cancelar). Já com nome: dá pra cancelar a edição. */
export function NomeModal({ aberto, nomeAtual, onConfirmar, onCancelar }: Props) {
  const [valor, setValor] = useState(nomeAtual);
  const [aviso, setAviso] = useState(false);

  useEffect(() => {
    if (aberto) {
      setValor(nomeAtual);
      setAviso(false);
    }
  }, [aberto, nomeAtual]);

  function confirmar() {
    const nome = valor.trim();
    if (!nome) {
      setAviso(true);
      return;
    }
    onConfirmar(nome.slice(0, 20));
  }

  return (
    <>
      <div className={`modal-overlay${aberto ? ' is-open' : ''}`} />
      <div className={`modal-panel modal-panel--nome${aberto ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-labelledby="nomeTitulo">
        <div className="modal-panel__header">
          <span className="modal-panel__title" id="nomeTitulo">
            Como podemos te chamar?
          </span>
        </div>
        <p className="nome-modal__texto">Um nome ou apelido curto ajuda a gente a saber de quem é cada pedido na mesa.</p>
        <label htmlFor="nomeInput" className="nome-modal__label">
          Seu nome ou apelido
        </label>
        <input
          id="nomeInput"
          type="text"
          className="nome-modal__input"
          maxLength={20}
          placeholder="Ex: João"
          autoComplete="off"
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            if (e.target.value.trim()) setAviso(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && confirmar()}
        />
        <span className={`nome-modal__aviso${aviso ? ' show' : ''}`}>Digite um nome pra continuar.</span>
        <div className="modal-panel__acoes">
          {nomeAtual && (
            <button type="button" className="btn btn--secondary" onClick={onCancelar}>
              Cancelar
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={confirmar}>
            Confirmar
          </button>
        </div>
      </div>
    </>
  );
}
