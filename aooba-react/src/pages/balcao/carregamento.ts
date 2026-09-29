import type { SupabaseClient } from '@supabase/supabase-js';
import type { PagamentoComMesa, PedidoComItens, Sessao } from '../../lib/types';

export interface Fechamento {
  id: string;
  mesa: number;
  criado_em: string;
}

export interface EstadoBalcao {
  /** Só pedidos "pendente", já com itens embutidos. */
  pedidos: PedidoComItens[];
  /** Pedidos de "fechar conta" (mesa inteira) ainda não atendidos. */
  fechamentos: Fechamento[];
  /** Pagamentos parciais ("fechar minha parte") ainda não confirmados. */
  pagamentos: PagamentoComMesa[];
  /** Sessões com status "aberta" — uma por mesa ocupada agora. */
  mesasAtivas: Sessao[];
}

/** Carga inicial de tudo. Lança em qualquer falha (a tela mostra "tentar de novo"). */
export async function carregarEstadoInicial(cliente: SupabaseClient): Promise<EstadoBalcao> {
  const [pedidos, fechamentos, pagamentos, sessoes] = await Promise.all([
    cliente
      .from('pedidos')
      .select('id, mesa, total, status, criado_em, cliente_nome, itens:pedido_itens(id, nome:nome_snapshot, preco:preco_unitario, quantidade)')
      .eq('tipo', 'pedido')
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true }),
    cliente.from('pedidos').select('id, mesa, criado_em').eq('tipo', 'fechar_conta').eq('status', 'pendente').order('criado_em', { ascending: true }),
    cliente
      .from('pagamentos')
      .select('id, sessao_id, cliente_id, nome, subtotal, taxa_servico, valor_total, taxa_aceita, status, criado_em, sessoes(mesa)')
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true }),
    cliente.from('sessoes').select('id, mesa, aberta_em').eq('status', 'aberta').order('mesa'),
  ]);

  const erro = pedidos.error || fechamentos.error || pagamentos.error || sessoes.error;
  if (erro) throw erro;

  type LinhaPagamento = Omit<PagamentoComMesa, 'mesa'> & { sessoes: { mesa: number } | null };

  return {
    pedidos: pedidos.data as unknown as PedidoComItens[],
    fechamentos: fechamentos.data as Fechamento[],
    pagamentos: (pagamentos.data as unknown as LinhaPagamento[]).map(({ sessoes: s, ...p }) => ({ ...p, mesa: s ? s.mesa : '?' })) as PagamentoComMesa[],
    mesasAtivas: sessoes.data as Sessao[],
  };
}
