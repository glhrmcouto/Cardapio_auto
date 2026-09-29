import { adicionarItem, alterarQuantidade, itensPayload, removerItem, totalCarrinho, totalItens, type ItemCarrinho } from '../carrinho';

describe('carrinho', () => {
  it('adicionar item novo cria linha com quantidade 1', () => {
    const c = adicionarItem([], 1, 'Caipirinha', 20);
    expect(c).toEqual([{ produtoId: 1, nome: 'Caipirinha', preco: 20, quantidade: 1, compartilhado: false }]);
  });

  it('adicionar o mesmo item soma +1', () => {
    const c = adicionarItem(adicionarItem([], 1, 'Caipirinha', 20), 1, 'Caipirinha', 20);
    expect(c).toHaveLength(1);
    expect(c[0].quantidade).toBe(2);
  });

  it('narguilé normal e "dividido" são linhas separadas', () => {
    let c: ItemCarrinho[] = adicionarItem([], 5, 'Narguilé', 80, false);
    c = adicionarItem(c, 5, 'Narguilé', 80, true);
    expect(c).toHaveLength(2);
  });

  it('alterar quantidade para 0 remove a linha', () => {
    const c = alterarQuantidade(adicionarItem([], 1, 'A', 10), 1, false, -1);
    expect(c).toEqual([]);
  });

  it('alterar quantidade não mexe em outra linha', () => {
    let c = adicionarItem([], 1, 'A', 10);
    c = adicionarItem(c, 2, 'B', 5);
    c = alterarQuantidade(c, 2, false, 2);
    expect(c.find((i) => i.produtoId === 1)!.quantidade).toBe(1);
    expect(c.find((i) => i.produtoId === 2)!.quantidade).toBe(3);
  });

  it('remover tira só a linha com o mesmo estado de compartilhado', () => {
    let c = adicionarItem([], 5, 'N', 80, false);
    c = adicionarItem(c, 5, 'N', 80, true);
    expect(removerItem(c, 5, true)).toEqual([expect.objectContaining({ compartilhado: false })]);
  });

  it('calcula totais e payload da RPC', () => {
    let c = adicionarItem([], 1, 'A', 10);
    c = adicionarItem(c, 1, 'A', 10);
    c = adicionarItem(c, 2, 'B', 5.5, true);
    expect(totalCarrinho(c)).toBe(25.5);
    expect(totalItens(c)).toBe(3);
    expect(itensPayload(c)).toEqual([
      { produto_id: 1, quantidade: 2, compartilhado: false },
      { produto_id: 2, quantidade: 1, compartilhado: true },
    ]);
  });

  it('essência entra com preço 0 sem afetar o total', () => {
    const c = adicionarItem(adicionarItem([], 1, 'Drink', 30), 9, 'Menta', 0);
    expect(totalCarrinho(c)).toBe(30);
  });
});
