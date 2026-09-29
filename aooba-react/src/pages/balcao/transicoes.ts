import type { Pedido, PedidoComItens, PedidoItem, Sessao, Pagamento } from '../../lib/types';
import type { EstadoBalcao } from './carregamento';

/** Transições puras do estado do balcão em resposta a eventos Realtime. */

const porCriacao = (a: { criado_em: string }, b: { criado_em: string }) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime();

export function inserirPedido(estado: EstadoBalcao, novo: Pedido, itens: PedidoItem[]): EstadoBalcao {
  if (novo.status !== 'pendente') return estado;
  const pedido: PedidoComItens = { ...novo, itens };
  return { ...estado, pedidos: [...estado.pedidos, pedido].sort(porCriacao) };
}

export function inserirFechamento(estado: EstadoBalcao, novo: Pedido): EstadoBalcao {
  if (novo.status !== 'pendente' || estado.fechamentos.some((f) => f.id === novo.id)) return estado;
  return { ...estado, fechamentos: [...estado.fechamentos, { id: novo.id, mesa: novo.mesa, criado_em: novo.criado_em }] };
}

/** Outro aparelho marcou "Entregue"/"Conta Fechada": tira da fila local. */
export function atualizarPedido(estado: EstadoBalcao, atualizado: Pedido): EstadoBalcao {
  if (atualizado.status === 'pendente') return estado;
  if (atualizado.tipo === 'fechar_conta') {
    return { ...estado, fechamentos: estado.fechamentos.filter((f) => f.id !== atualizado.id) };
  }
  return { ...estado, pedidos: estado.pedidos.filter((p) => p.id !== atualizado.id) };
}

export function inserirPagamento(estado: EstadoBalcao, novo: Pagamento, mesa: number | string): EstadoBalcao {
  if (novo.status !== 'pendente' || estado.pagamentos.some((p) => p.id === novo.id)) return estado;
  return { ...estado, pagamentos: [...estado.pagamentos, { ...novo, mesa }] };
}

export function atualizarPagamento(estado: EstadoBalcao, atualizado: Pagamento): EstadoBalcao {
  if (atualizado.status !== 'confirmado') return estado;
  return { ...estado, pagamentos: estado.pagamentos.filter((p) => p.id !== atualizado.id) };
}

export function inserirSessao(estado: EstadoBalcao, nova: Sessao): EstadoBalcao {
  if (nova.status !== 'aberta' || estado.mesasAtivas.some((s) => s.id === nova.id)) return estado;
  return { ...estado, mesasAtivas: [...estado.mesasAtivas, nova] };
}

export function atualizarSessao(estado: EstadoBalcao, atualizada: Sessao): EstadoBalcao {
  if (atualizada.status === 'aberta') return estado;
  return { ...estado, mesasAtivas: estado.mesasAtivas.filter((s) => s.id !== atualizada.id) };
}

export type EstadoConexao = 'online' | 'conectando' | 'reconectando' | 'offline';

/** Combina rede do navegador + status do canal Realtime no indicador do header. */
export function calcularConexao(redeOnline: boolean, canal: string): EstadoConexao {
  if (!redeOnline) return 'offline';
  if (canal === 'SUBSCRIBED') return 'online';
  if (canal === 'conectando') return 'conectando';
  return 'reconectando';
}
