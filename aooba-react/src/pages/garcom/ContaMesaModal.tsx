import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { ListaItens } from '../../components/ContaViews';
import { supabaseGarcom as supabase } from '../../lib/supabase';
import { tentarEncerrarSessao } from '../../lib/contas';
import { formatarPreco } from '../../lib/shared';
import type { ContaBalcao } from '../../lib/types';

interface Props {
  /** Mesa aberta no modal; null = fechado. */
  mesa: number | null;
  onFechar: () => void;
  aoFechada: (mesa: number) => void;
}

export function ContaMesaModal({ mesa, onFechar, aoFechada }: Props) {
  const [conta, setConta] = useState<ContaBalcao | null>(null);
  const [fechando, setFechando] = useState(false);

  useEffect(() => {
    if (mesa === null) return;
    let vivo = true;
    setConta(null);
    void supabase.rpc('conta_da_mesa_balcao', { p_mesa: mesa }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) {
        console.error('Erro ao consultar conta da mesa:', error);
        window.alert('Não foi possível carregar a conta agora. Verifique sua conexão e tente de novo.');
        return;
      }
      setConta(data as ContaBalcao);
    });
    return () => {
      vivo = false;
    };
  }, [mesa]);

  async function fechar() {
    if (mesa === null || !conta) return;
    if (!window.confirm(`Fechar a conta da Mesa ${mesa}? Total: ${formatarPreco(conta.total_geral)}. Essa ação não pode ser desfeita.`)) return;

    setFechando(true);
    const ok = await tentarEncerrarSessao(supabase, mesa);
    setFechando(false);
    if (!ok) return;

    const fechada = mesa;
    onFechar();
    aoFechada(fechada);
  }

  return (
    <Modal aberto={mesa !== null} onFechar={onFechar} titulo={<>Conta — Mesa {mesa}</>} variante="modal-panel--conta-mesa">
      {conta && conta.itens.length === 0 && <p className="modal-panel__vazio">Nenhum pedido registrado ainda.</p>}
      <div className="modal-panel__itens">{conta && conta.itens.length > 0 && <ListaItens itens={conta.itens} />}</div>
      <div className="np-rodape">
        <span className="np-rodape__total">
          Total: <strong>{conta ? formatarPreco(conta.total_geral) : 'Carregando...'}</strong>
        </span>
      </div>
      <button type="button" className="btn btn--primary conta-mesa__fechar" disabled={!conta || fechando} onClick={() => void fechar()}>
        {fechando ? 'Fechando...' : 'Fechar conta'}
      </button>
    </Modal>
  );
}
