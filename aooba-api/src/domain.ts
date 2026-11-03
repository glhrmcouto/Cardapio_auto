import type { Categoria } from './db/schema.js';

export interface ProdutoMenu {
  id: number;
  nome: string;
  descricao: string;
  preco: number;
  categoria: Categoria;
}

export interface SessaoAtual {
  sessao_id: string;
  token_sessao: string;
}

export interface ItemPedido {
  produtoId: number;
  quantidade: number;
  compartilhado: boolean;
}

export interface Credencial {
  mesa: number;
  token: string;
}

export type StatusSolicitacao = 'pendente' | 'aprovada' | 'recusada';

export interface PedidoEntrada extends Credencial {
  clienteId: string;
  nome: string;
}

export interface NovoPedido extends Credencial {
  itens: ItemPedido[];
  clienteNome: string;
  clienteId: string;
  tokenSessao: string | null;
}

export interface PedidoCriado {
  id: string;
  mesa: number;
  total: number;
  status: string;
}

/**
 * Porta do fluxo do cliente. A implementação real (PgClienteRepository) usa Drizzle + as funções do
 * Postgres; os testes usam uma implementação em memória.
 */
export interface ClienteRepository {
  listarProdutos(): Promise<ProdutoMenu[]>;
  statusDaMesa(c: Credencial): Promise<'liberada' | 'bloqueada'>;
  sessaoAtual(c: Credencial): Promise<SessaoAtual | null>;
  abrirSessao(c: Credencial): Promise<SessaoAtual>;
  /** Fila de aprovação: o cliente pede entrada numa mesa bloqueada com o nome que o garçom vai confirmar. */
  solicitarEntrada(p: PedidoEntrada): Promise<{ id: string | null; status: StatusSolicitacao }>;
  statusSolicitacao(c: Credencial & { clienteId: string }): Promise<StatusSolicitacao | null>;
  criarPedido(p: NovoPedido): Promise<PedidoCriado>;
  contaDaMesa(c: Credencial & { clienteId: string | null; tokenSessao: string | null }): Promise<unknown>;
  fecharParcial(c: Credencial & { clienteId: string; aceitaTaxa: boolean }): Promise<{ valor_total: number }>;
  pedirFechamento(c: Credencial & { tokenSessao: string | null }): Promise<{ id: string }>;
}
