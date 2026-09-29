export interface ItemCarrinho {
  produtoId: number;
  nome: string;
  /** Só para exibição — o preço real é recalculado no banco (criar_pedido). */
  preco: number;
  quantidade: number;
  compartilhado: boolean;
}

const mesmo = (i: ItemCarrinho, produtoId: number, compartilhado: boolean) => i.produtoId === produtoId && i.compartilhado === compartilhado;

/** Soma +1 se já existe com o MESMO estado de "compartilhado"; senão cria a linha. */
export function adicionarItem(carrinho: ItemCarrinho[], produtoId: number, nome: string, preco: number, compartilhado = false): ItemCarrinho[] {
  if (carrinho.some((i) => mesmo(i, produtoId, compartilhado))) {
    return carrinho.map((i) => (mesmo(i, produtoId, compartilhado) ? { ...i, quantidade: i.quantidade + 1 } : i));
  }
  return [...carrinho, { produtoId, nome, preco, quantidade: 1, compartilhado }];
}

/** Soma/subtrai quantidade; remove a linha se chegar a 0. */
export function alterarQuantidade(carrinho: ItemCarrinho[], produtoId: number, compartilhado: boolean, delta: number): ItemCarrinho[] {
  return carrinho
    .map((i) => (mesmo(i, produtoId, compartilhado) ? { ...i, quantidade: i.quantidade + delta } : i))
    .filter((i) => i.quantidade > 0);
}

export function removerItem(carrinho: ItemCarrinho[], produtoId: number, compartilhado: boolean): ItemCarrinho[] {
  return carrinho.filter((i) => !mesmo(i, produtoId, compartilhado));
}

export const totalCarrinho = (carrinho: ItemCarrinho[]) => carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);
export const totalItens = (carrinho: ItemCarrinho[]) => carrinho.reduce((s, i) => s + i.quantidade, 0);

/** Payload da RPC criar_pedido. */
export const itensPayload = (carrinho: ItemCarrinho[]) =>
  carrinho.map((i) => ({ produto_id: i.produtoId, quantidade: i.quantidade, compartilhado: i.compartilhado }));
