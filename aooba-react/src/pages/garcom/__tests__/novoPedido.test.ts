import { calcularTotalNovoPedido } from '../NovoPedidoModal';

const produtos = [
  { id: 1, nome: 'Chopp', preco: 12, categoria: 'cerveja' as const },
  { id: 2, nome: 'Caipirinha', preco: 22.5, categoria: 'drink' as const },
];

describe('calcularTotalNovoPedido', () => {
  it('carrinho vazio => total 0 e nenhum item (botão desabilitado)', () => {
    expect(calcularTotalNovoPedido({}, produtos)).toEqual({ total: 0, itens: 0 });
  });

  it('soma preço x quantidade', () => {
    expect(calcularTotalNovoPedido({ 1: 2, 2: 1 }, produtos)).toEqual({ total: 46.5, itens: 3 });
  });

  it('ignora produto que não está mais no cardápio no total, mas conta o item', () => {
    expect(calcularTotalNovoPedido({ 99: 1 }, produtos)).toEqual({ total: 0, itens: 1 });
  });
});
