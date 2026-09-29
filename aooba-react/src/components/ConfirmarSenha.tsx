import { useCallback, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Modal } from './Modal';

/**
 * Reautentica com a MESMA conta já logada (signInWithPassword) só pra confirmar
 * que quem está no balcão agora sabe a senha. Uso:
 *   const { pedir, modal } = useConfirmarSenha(supabase);
 *   pedir(() => acaoSensivel());  ...  {modal}
 */
export function useConfirmarSenha(cliente: SupabaseClient) {
  const acaoRef = useRef<(() => void | Promise<void>) | null>(null);
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const pedir = useCallback((acao: () => void | Promise<void>) => {
    acaoRef.current = acao;
    setSenha('');
    setErro(false);
    setAberto(true);
  }, []);

  const fechar = useCallback(() => {
    acaoRef.current = null;
    setAberto(false);
  }, []);

  async function confirmar() {
    const acao = acaoRef.current;
    if (!senha || !acao) return;

    setConfirmando(true);
    setErro(false);
    const {
      data: { user },
    } = await cliente.auth.getUser();
    const { error } = await cliente.auth.signInWithPassword({ email: user?.email ?? '', password: senha });
    setConfirmando(false);

    if (error) {
      setErro(true);
      return;
    }
    fechar();
    await acao();
  }

  const modal = (
    <Modal aberto={aberto} onFechar={fechar} titulo="Confirme a senha" variante="modal-panel--nome" comFechar={false}>
      <p className="nome-modal__texto">Essa ação precisa da senha do balcão pra continuar.</p>
      <label htmlFor="confirmarSenhaInput" className="nome-modal__label">
        Senha
      </label>
      <input
        id="confirmarSenhaInput"
        type="password"
        className="nome-modal__input"
        autoComplete="current-password"
        autoFocus
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void confirmar()}
      />
      <span className={`nome-modal__aviso${erro ? ' show' : ''}`}>Senha incorreta.</span>
      <div className="modal-panel__acoes">
        <button type="button" className="btn btn--secondary" onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="btn btn--primary" disabled={confirmando} onClick={() => void confirmar()}>
          {confirmando ? 'Confirmando...' : 'Confirmar'}
        </button>
      </div>
    </Modal>
  );

  return { pedir, modal };
}
