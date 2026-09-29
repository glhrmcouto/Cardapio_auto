export type Papel = 'admin' | 'balcao' | 'garcom';
export type Categoria = 'drink' | 'cerveja' | 'sem_alcool' | 'narguile' | 'essencia';
export type StatusPessoa = 'em_aberto' | 'aguardando' | 'pago';

export interface Produto {
  id: number;
  nome: string;
  descricao: string;
  preco: number;
  categoria: Categoria;
  ativo: boolean;
  ordem: number;
}

export interface Mesa {
  numero: number;
  token: string;
  ativa: boolean;
  status_mesa: 'liberada' | 'bloqueada';
}

export interface Pedido {
  id: string;
  tipo: 'pedido' | 'fechar_conta';
  mesa: number;
  total: number;
  status: 'pendente' | 'entregue' | 'finalizado';
  criado_em: string;
  sessao_id: string | null;
  cliente_nome: string | null;
  cliente_id: string | null;
  origem: 'cliente' | 'garcom';
}

export interface PedidoItem {
  id: number;
  nome: string;
  preco: number;
  quantidade: number;
}

export interface PedidoComItens extends Pedido {
  itens: PedidoItem[];
}

export interface Sessao {
  id: string;
  mesa: number;
  aberta_em: string;
  fechada_em: string | null;
  status: 'aberta' | 'fechada';
}

export interface Pagamento {
  id: string;
  sessao_id: string;
  cliente_id: string;
  nome: string;
  valor_total: number;
  status: 'pendente' | 'confirmado';
  criado_em: string;
  confirmado_em: string | null;
  subtotal: number;
  taxa_servico: number;
  taxa_aceita: boolean;
}

export interface PagamentoComMesa extends Pagamento {
  mesa: number | string;
}

export interface ItemConta {
  nome: string;
  preco: number;
  quantidade: number;
}

export interface PessoaConta {
  nome: string;
  status: StatusPessoa;
  valor: number;
  subtotal: number;
  taxa_servico: number;
}

export interface ContaBalcao {
  itens: ItemConta[];
  subtotal: number;
  taxa_servico: number;
  total_geral: number;
  total_pago: number;
  total_pendente_confirmacao: number;
  saldo_restante: number;
  por_pessoa: PessoaConta[];
}

export interface ItemDireto extends ItemConta {
  pago?: boolean;
}

export interface ItemCompartilhado {
  nome: string;
  valor: number;
  pago?: boolean;
}

export interface MinhaParte {
  status: StatusPessoa;
  itens_diretos: ItemDireto[];
  itens_compartilhados: ItemCompartilhado[];
  subtotal_em_aberto: number;
  subtotal_aguardando: number;
  taxa_aguardando: number;
  total_aguardando: number;
  subtotal_pago: number;
  taxa_pago: number;
  total_pago: number;
}

export interface ContaCliente extends ContaBalcao {
  taxa_servico_percentual: number;
  minha_parte: MinhaParte;
}

export interface SessaoAtual {
  sessao_id: string;
  token_sessao: string;
}
