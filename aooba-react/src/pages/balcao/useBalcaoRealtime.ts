import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pagamento, Pedido, PedidoItem, Sessao } from '../../lib/types';
import type { TipoBeep } from '../../hooks/useBeep';
import type { EstadoBalcao } from './carregamento';
import {
  atualizarPagamento,
  atualizarPedido,
  atualizarSessao,
  calcularConexao,
  inserirFechamento,
  inserirPagamento,
  inserirPedido,
  inserirSessao,
  type EstadoConexao,
} from './transicoes';

interface Params {
  cliente: SupabaseClient;
  setEstado: Dispatch<SetStateAction<EstadoBalcao>>;
  /** Incrementa a "versão" para os cards de conta rebuscarem os totais. */
  bump: () => void;
  beep: (tipo: TipoBeep) => void;
  /** Sessão fechada em outro aparelho: a mesa ficou bloqueada. */
  aoSessaoEncerrada: (mesa: number) => void;
}

/** Assina INSERT/UPDATE de pedidos, pagamentos e sessões; devolve o estado de conexão. */
export function useBalcaoRealtime({ cliente, setEstado, bump, beep, aoSessaoEncerrada }: Params): EstadoConexao {
  const [redeOnline, setRedeOnline] = useState(navigator.onLine);
  const [canal, setCanal] = useState('conectando');

  useEffect(() => {
    const on = () => setRedeOnline(true);
    const off = () => setRedeOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const canalRt = cliente
      .channel('balcao-pedidos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, async (payload) => {
        const novo = payload.new as Pedido;
        if (novo.status !== 'pendente') return;
        if (novo.tipo === 'fechar_conta') {
          setEstado((e) => inserirFechamento(e, novo));
          bump();
          beep('fechamento');
          return;
        }
        // O evento só traz a linha de "pedidos": busca os itens à parte.
        const { data, error } = await cliente
          .from('pedido_itens')
          .select('id, nome:nome_snapshot, preco:preco_unitario, quantidade')
          .eq('pedido_id', novo.id);
        setEstado((e) => inserirPedido(e, novo, error ? [] : (data as PedidoItem[])));
        bump();
        beep('pedido');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, (payload) => {
        setEstado((e) => atualizarPedido(e, payload.new as Pedido));
        bump();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pagamentos' }, async (payload) => {
        const novo = payload.new as Pagamento;
        if (novo.status !== 'pendente') return;
        const { data: sessao, error } = await cliente.from('sessoes').select('mesa').eq('id', novo.sessao_id).single();
        if (error) console.error('Erro ao buscar mesa do pagamento novo:', error);
        setEstado((e) => inserirPagamento(e, novo, sessao ? (sessao.mesa as number) : '?'));
        bump();
        beep('fechamento');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pagamentos' }, (payload) => {
        setEstado((e) => atualizarPagamento(e, payload.new as Pagamento));
        bump();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessoes' }, (payload) => {
        setEstado((e) => inserirSessao(e, payload.new as Sessao));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes' }, (payload) => {
        const atualizada = payload.new as Sessao;
        setEstado((e) => atualizarSessao(e, atualizada));
        if (atualizada.status !== 'aberta') aoSessaoEncerrada(atualizada.mesa);
      })
      .subscribe((status) => setCanal(status));

    return () => {
      void cliente.removeChannel(canalRt);
      setCanal('conectando');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente]);

  return calcularConexao(redeOnline, canal);
}
