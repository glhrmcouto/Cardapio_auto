import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { ListaItens } from '../../components/ContaViews';
import { supabase } from '../../lib/supabase';
import { formatarData, formatarHorario, formatarPreco } from '../../lib/shared';
import type { ItemConta } from '../../lib/types';

interface PedidoHistorico {
  id: string;
  mesa: number;
  total: number;
  status: 'pendente' | 'entregue' | 'finalizado';
  criado_em: string;
  itens: ItemConta[];
}

const STATUS_LABEL = { pendente: 'Pendente', entregue: 'Entregue', finalizado: 'Finalizado' };

/** Intervalo [inicio, fim) do filtro: um dia específico ou os últimos 30 dias (incluindo hoje). */
export function intervaloHistorico(filtro: string, agora = new Date()): { inicio: Date; fim: Date } {
  if (filtro) {
    const [ano, mes, dia] = filtro.split('-').map(Number);
    return { inicio: new Date(ano, mes - 1, dia), fim: new Date(ano, mes - 1, dia + 1) };
  }
  const fim = new Date(agora);
  fim.setHours(24, 0, 0, 0);
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - 30);
  return { inicio, fim };
}

export function HistoricoModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [filtro, setFiltro] = useState('');
  const [lista, setLista] = useState<PedidoHistorico[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setLista(null);
    setErro(false);
    const { inicio, fim } = intervaloHistorico(filtro);
    void supabase
      .from('pedidos')
      .select('id, mesa, total, status, criado_em, itens:pedido_itens(nome:nome_snapshot, preco:preco_unitario, quantidade)')
      .eq('tipo', 'pedido')
      .gte('criado_em', inicio.toISOString())
      .lt('criado_em', fim.toISOString())
      .order('criado_em', { ascending: false })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          console.error('Erro ao carregar histórico:', error);
          setErro(true);
        } else {
          setLista(data as unknown as PedidoHistorico[]);
        }
      });
    return () => {
      vivo = false;
    };
  }, [aberto, filtro]);

  let mensagem: string | null = null;
  if (erro) mensagem = 'Não foi possível carregar o histórico agora. Verifique sua conexão.';
  else if (lista === null) mensagem = 'Carregando...';
  else if (lista.length === 0) mensagem = filtro ? 'Nenhum pedido registrado nessa data.' : 'Nenhum pedido nos últimos 30 dias.';

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Histórico de Pedidos" variante="modal-panel--historico">
      <div className="modal-panel__filtro">
        <label htmlFor="historicoFiltroData">Filtrar por data:</label>
        <input type="date" id="historicoFiltroData" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <button className="modal-panel__filtro-limpar" type="button" onClick={() => setFiltro('')}>
          Limpar
        </button>
      </div>
      {mensagem && <p className="modal-panel__vazio">{mensagem}</p>}
      <div className="modal-panel__itens">
        {!mensagem &&
          lista?.map((pedido) => (
            <div className="historico-pedido" key={pedido.id}>
              <div className="historico-pedido__header">
                <span className="historico-pedido__mesa">Mesa {pedido.mesa}</span>
                <span className="historico-pedido__horario">
                  {formatarData(pedido.criado_em)} às {formatarHorario(pedido.criado_em)}
                </span>
              </div>
              <span className={`historico-pedido__status historico-pedido__status--${pedido.status}`}>{STATUS_LABEL[pedido.status] || pedido.status}</span>
              <ListaItens itens={pedido.itens} />
              <div className="pedido-card__total">Total: {formatarPreco(pedido.total)}</div>
            </div>
          ))}
      </div>
    </Modal>
  );
}
