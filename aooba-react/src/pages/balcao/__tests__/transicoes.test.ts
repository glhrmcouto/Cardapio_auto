import type { Pagamento, Pedido, Sessao } from '../../../lib/types';
import type { EstadoBalcao } from '../carregamento';
import {
  atualizarPagamento,
  atualizarPedido,
  atualizarSessao,
  calcularConexao,
  inserirFechamento,
  inserirPagamento,
  inserirPedido,
  inserirSessao,
} from '../transicoes';

const vazio: EstadoBalcao = { pedidos: [], fechamentos: [], pagamentos: [], mesasAtivas: [] };
const pedido = (o: Partial<Pedido> = {}): Pedido => ({
  id: 'p1', tipo: 'pedido', mesa: 1, total: 10, status: 'pendente', criado_em: '2026-01-01T10:00:00Z',
  sessao_id: 's', cliente_nome: 'Ana', cliente_id: 'c', origem: 'cliente', ...o,
});
const pagamento = (o: Partial<Pagamento> = {}): Pagamento => ({
  id: 'g1', sessao_id: 's', cliente_id: 'c', nome: 'Ana', valor_total: 11, status: 'pendente',
  criado_em: '2026-01-01T10:00:00Z', confirmado_em: null, subtotal: 10, taxa_servico: 1, taxa_aceita: true, ...o,
});
const sessao = (o: Partial<Sessao> = {}): Sessao => ({ id: 's1', mesa: 2, aberta_em: '2026-01-01T09:00:00Z', fechada_em: null, status: 'aberta', ...o });

describe('pedidos', () => {
  it('insere pedido pendente com itens, mantendo ordem por criação', () => {
    let e = inserirPedido(vazio, pedido({ id: 'tarde', criado_em: '2026-01-01T12:00:00Z' }), []);
    e = inserirPedido(e, pedido({ id: 'cedo', criado_em: '2026-01-01T08:00:00Z' }), [{ id: 1, nome: 'X', preco: 5, quantidade: 2 }]);
    expect(e.pedidos.map((p) => p.id)).toEqual(['cedo', 'tarde']);
    expect(e.pedidos[0].itens).toHaveLength(1);
  });

  it('ignora pedido que não está pendente', () => {
    expect(inserirPedido(vazio, pedido({ status: 'entregue' }), [])).toBe(vazio);
  });

  it('UPDATE para entregue tira da fila (outro aparelho entregou)', () => {
    const e = inserirPedido(vazio, pedido(), []);
    expect(atualizarPedido(e, pedido({ status: 'entregue' })).pedidos).toEqual([]);
  });

  it('UPDATE que continua pendente não mexe', () => {
    const e = inserirPedido(vazio, pedido(), []);
    expect(atualizarPedido(e, pedido())).toBe(e);
  });
});

describe('fechamentos', () => {
  it('insere pedido de fechar_conta e evita duplicata', () => {
    const f = pedido({ id: 'f1', tipo: 'fechar_conta', mesa: 3 });
    const e = inserirFechamento(vazio, f);
    expect(e.fechamentos).toEqual([{ id: 'f1', mesa: 3, criado_em: f.criado_em }]);
    expect(inserirFechamento(e, f)).toBe(e);
  });

  it('UPDATE de fechar_conta atendido remove só o fechamento', () => {
    let e = inserirFechamento(vazio, pedido({ id: 'f1', tipo: 'fechar_conta' }));
    e = inserirPedido(e, pedido({ id: 'p9' }), []);
    const r = atualizarPedido(e, pedido({ id: 'f1', tipo: 'fechar_conta', status: 'finalizado' }));
    expect(r.fechamentos).toEqual([]);
    expect(r.pedidos).toHaveLength(1);
  });
});

describe('pagamentos', () => {
  it('insere pendente com a mesa e sem duplicar', () => {
    const e = inserirPagamento(vazio, pagamento(), 4);
    expect(e.pagamentos[0].mesa).toBe(4);
    expect(inserirPagamento(e, pagamento(), 4)).toBe(e);
  });

  it('confirmado sai da lista; pendente é ignorado', () => {
    const e = inserirPagamento(vazio, pagamento(), 4);
    expect(atualizarPagamento(e, pagamento({ status: 'confirmado' })).pagamentos).toEqual([]);
    expect(atualizarPagamento(e, pagamento())).toBe(e);
  });
});

describe('sessões / mesas ativas', () => {
  it('só entra sessão aberta e sem duplicar', () => {
    expect(inserirSessao(vazio, sessao({ status: 'fechada' }))).toBe(vazio);
    const e = inserirSessao(vazio, sessao());
    expect(inserirSessao(e, sessao())).toBe(e);
  });

  it('sessão fechada sai de Mesas Ativas', () => {
    const e = inserirSessao(vazio, sessao());
    expect(atualizarSessao(e, sessao({ status: 'fechada' })).mesasAtivas).toEqual([]);
  });
});

describe('calcularConexao', () => {
  it('offline do navegador vence o canal', () => {
    expect(calcularConexao(false, 'SUBSCRIBED')).toBe('offline');
  });
  it('online quando o canal está SUBSCRIBED', () => {
    expect(calcularConexao(true, 'SUBSCRIBED')).toBe('online');
  });
  it('conectando no início e reconectando em qualquer outro estado', () => {
    expect(calcularConexao(true, 'conectando')).toBe('conectando');
    expect(calcularConexao(true, 'CHANNEL_ERROR')).toBe('reconectando');
    expect(calcularConexao(true, 'TIMED_OUT')).toBe('reconectando');
  });
});
