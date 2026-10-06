export type Categoria = 'drink' | 'cerveja' | 'sem_alcool' | 'narguile' | 'essencia';
export type StatusPessoa = 'em_aberto' | 'aguardando' | 'pago';

/** Acesso lido do QR da mesa. O token da mesa é permanente; quem autoriza pedir é o token de SESSÃO. */
export interface AcessoMesa {
  mesa: number;
  token: string;
}

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

export interface ContaCliente {
  itens: ItemConta[];
  subtotal: number;
  taxa_servico: number;
  total_geral: number;
  total_pago: number;
  total_pendente_confirmacao: number;
  saldo_restante: number;
  por_pessoa: PessoaConta[];
  taxa_servico_percentual: number;
  minha_parte: MinhaParte;
}

export interface PedidoCriado {
  id: string;
  mesa: number;
  total: number;
  status: string;
}
