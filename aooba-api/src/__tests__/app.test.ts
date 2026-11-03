import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../app.js';
import type { ClienteRepository } from '../domain.js';
import { ErroNegocio, traduzirErroPg } from '../errors.js';

const UUID = '3f2b8c1e-5d4a-4f6b-9a7c-1e2d3c4b5a69';

function repoFalso(sobrescrever: Partial<ClienteRepository> = {}): ClienteRepository {
  return {
    listarProdutos: vi.fn().mockResolvedValue([{ id: 1, nome: 'Gin', descricao: 'd', preco: 20, categoria: 'drink' }]),
    statusDaMesa: vi.fn().mockResolvedValue('liberada'),
    sessaoAtual: vi.fn().mockResolvedValue(null),
    abrirSessao: vi.fn().mockResolvedValue({ sessao_id: 's1', token_sessao: 'ts1' }),
    solicitarEntrada: vi.fn().mockResolvedValue({ id: 'sol1', status: 'pendente' }),
    statusSolicitacao: vi.fn().mockResolvedValue('pendente'),
    criarPedido: vi.fn().mockResolvedValue({ id: 'p1', mesa: 5, total: 40, status: 'pendente' }),
    contaDaMesa: vi.fn().mockResolvedValue({ total_geral: 40 }),
    fecharParcial: vi.fn().mockResolvedValue({ valor_total: 22 }),
    pedirFechamento: vi.fn().mockResolvedValue({ id: 'p2' }),
    ...sobrescrever,
  };
}

const pedidoValido = {
  mesa: 5,
  token: 'tok',
  itens: [{ produtoId: 1, quantidade: 2, compartilhado: false }],
  clienteNome: 'Maria',
  clienteId: UUID,
  tokenSessao: 'ts1',
};

describe('GET /api/produtos', () => {
  it('devolve os produtos do repositório', async () => {
    const res = await request(criarApp(repoFalso())).get('/api/produtos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, nome: 'Gin', descricao: 'd', preco: 20, categoria: 'drink' }]);
  });
});

describe('mesa e sessão', () => {
  it('status exige o token (t) na query', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).get('/api/mesas/5/status');
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('DADOS_INVALIDOS');
    expect(repo.statusDaMesa).not.toHaveBeenCalled();
  });

  it('status repassa mesa e token ao repositório', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).get('/api/mesas/5/status?t=abc');
    expect(res.body).toEqual({ status: 'liberada' });
    expect(repo.statusDaMesa).toHaveBeenCalledWith({ mesa: 5, token: 'abc' });
  });

  it('GET sessão só lê: devolve sessao null e não abre sessão', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).get('/api/mesas/5/sessao?t=abc');
    expect(res.body).toEqual({ sessao: null });
    expect(repo.abrirSessao).not.toHaveBeenCalled();
  });

  it('POST sessão abre sessão (201)', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).post('/api/mesas/5/sessao').send({ t: 'abc' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ sessao: { sessao_id: 's1', token_sessao: 'ts1' } });
    expect(repo.abrirSessao).toHaveBeenCalledWith({ mesa: 5, token: 'abc' });
  });

  it('mesa bloqueada vira 423 com o código MESA_BLOQUEADA', async () => {
    const repo = repoFalso({ abrirSessao: vi.fn().mockRejectedValue(new ErroNegocio('Mesa aguardando liberação do atendente.', 'MESA_BLOQUEADA', 423)) });
    const res = await request(criarApp(repo)).post('/api/mesas/5/sessao').send({ t: 'abc' });
    expect(res.status).toBe(423);
    expect(res.body).toEqual({ codigo: 'MESA_BLOQUEADA', mensagem: 'Mesa aguardando liberação do atendente.' });
  });

  it('número de mesa inválido é recusado antes de chegar ao banco', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).get('/api/mesas/abc/sessao?t=x');
    expect(res.status).toBe(400);
    expect(repo.sessaoAtual).not.toHaveBeenCalled();
  });
});

describe('fila de aprovação', () => {
  it('POST solicitação envia mesa, token, clienteId e nome ao repositório (201)', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).post('/api/mesas/5/solicitacao').send({ t: 'abc', clienteId: UUID, nome: '  João ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'sol1', status: 'pendente' });
    expect(repo.solicitarEntrada).toHaveBeenCalledWith({ mesa: 5, token: 'abc', clienteId: UUID, nome: 'João' });
  });

  it('recusa nome vazio, nome com mais de 20 caracteres e clienteId inválido', async () => {
    const repo = repoFalso();
    const app = criarApp(repo);
    for (const corpo of [
      { t: 'abc', clienteId: UUID, nome: '   ' },
      { t: 'abc', clienteId: UUID, nome: 'x'.repeat(21) },
      { t: 'abc', clienteId: 'nao-e-uuid', nome: 'João' },
    ]) {
      const res = await request(app).post('/api/mesas/5/solicitacao').send(corpo);
      expect(res.status).toBe(400);
      expect(res.body.codigo).toBe('DADOS_INVALIDOS');
    }
    expect(repo.solicitarEntrada).not.toHaveBeenCalled();
  });

  it('GET solicitação devolve o status (ou null se nunca pediu)', async () => {
    const repo = repoFalso({ statusSolicitacao: vi.fn().mockResolvedValue(null) });
    const res = await request(criarApp(repo)).get(`/api/mesas/5/solicitacao?t=abc&clienteId=${UUID}`);
    expect(res.body).toEqual({ status: null });
    expect(repo.statusSolicitacao).toHaveBeenCalledWith({ mesa: 5, token: 'abc', clienteId: UUID });
  });

  it('GET solicitação exige token e clienteId', async () => {
    const res = await request(criarApp(repoFalso())).get('/api/mesas/5/solicitacao?t=abc');
    expect(res.status).toBe(400);
  });

  it('erro de regra do banco (ex.: QR inválido) volta como 400 com a mensagem', async () => {
    const repo = repoFalso({ solicitarEntrada: vi.fn().mockRejectedValue(new ErroNegocio('Verifique o QR code da mesa.')) });
    const res = await request(criarApp(repo)).post('/api/mesas/5/solicitacao').send({ t: 'abc', clienteId: UUID, nome: 'João' });
    expect(res.status).toBe(400);
    expect(res.body.mensagem).toBe('Verifique o QR code da mesa.');
  });
});

describe('POST /api/pedidos', () => {
  it('cria pedido válido', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).post('/api/pedidos').send(pedidoValido);
    expect(res.status).toBe(201);
    expect(res.body.pedido.total).toBe(40);
    expect(repo.criarPedido).toHaveBeenCalledWith(pedidoValido);
  });

  it('ignora preço enviado pelo cliente (nunca chega ao repositório)', async () => {
    const repo = repoFalso();
    const comPreco = { ...pedidoValido, itens: [{ produtoId: 1, quantidade: 1, compartilhado: false, preco: 0.01 }] };
    await request(criarApp(repo)).post('/api/pedidos').send(comPreco);
    const enviado = (repo.criarPedido as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(enviado.itens[0]).toEqual({ produtoId: 1, quantidade: 1, compartilhado: false });
  });

  it.each([
    ['sem itens', { ...pedidoValido, itens: [] }],
    ['quantidade zero', { ...pedidoValido, itens: [{ produtoId: 1, quantidade: 0, compartilhado: false }] }],
    ['nome vazio', { ...pedidoValido, clienteNome: '   ' }],
    ['nome com mais de 20 caracteres', { ...pedidoValido, clienteNome: 'x'.repeat(21) }],
    ['clienteId que não é uuid', { ...pedidoValido, clienteId: '123' }],
  ])('recusa %s', async (_nome, corpo) => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).post('/api/pedidos').send(corpo);
    expect(res.status).toBe(400);
    expect(repo.criarPedido).not.toHaveBeenCalled();
  });

  it('sessão encerrada vira 409 SESSAO_ENCERRADA', async () => {
    const repo = repoFalso({ criarPedido: vi.fn().mockRejectedValue(new ErroNegocio('Esta conta foi encerrada.', 'SESSAO_ENCERRADA', 409)) });
    const res = await request(criarApp(repo)).post('/api/pedidos').send(pedidoValido);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('SESSAO_ENCERRADA');
  });

  it('JSON malformado é 400', async () => {
    const res = await request(criarApp(repoFalso())).post('/api/pedidos').set('Content-Type', 'application/json').send('{ruim');
    expect(res.status).toBe(400);
  });
});

describe('conta', () => {
  it('consulta a conta com token de sessão e clienteId', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).post('/api/conta').send({ mesa: 5, token: 'tok', clienteId: UUID, tokenSessao: 'ts1' });
    expect(res.body).toEqual({ conta: { total_geral: 40 } });
    expect(repo.contaDaMesa).toHaveBeenCalledWith({ mesa: 5, token: 'tok', clienteId: UUID, tokenSessao: 'ts1' });
  });

  it('fechar minha parte devolve o valor', async () => {
    const repo = repoFalso();
    const res = await request(criarApp(repo)).post('/api/conta/fechar-parte').send({ mesa: 5, token: 'tok', clienteId: UUID, aceitaTaxa: false });
    expect(res.body).toEqual({ valor_total: 22 });
    expect(repo.fecharParcial).toHaveBeenCalledWith({ mesa: 5, token: 'tok', clienteId: UUID, aceitaTaxa: false });
  });

  it('pedir fechamento da conta toda (201)', async () => {
    const res = await request(criarApp(repoFalso())).post('/api/conta/fechar').send({ mesa: 5, token: 'tok', tokenSessao: 'ts1' });
    expect(res.status).toBe(201);
  });
});

describe('erros inesperados', () => {
  it('500 genérico, sem vazar a mensagem interna', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = repoFalso({ listarProdutos: vi.fn().mockRejectedValue(new Error('password authentication failed for user postgres')) });
    const res = await request(criarApp(repo)).get('/api/produtos');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('rota inexistente é 404', async () => {
    const res = await request(criarApp(repoFalso())).get('/api/nada');
    expect(res.status).toBe(404);
  });
});

describe('traduzirErroPg', () => {
  const erroPg = (detail: string | null, code = 'P0001') => Object.assign(new Error('Esta conta foi encerrada.'), { code, detail });

  it('P0001 com detail SESSAO_ENCERRADA -> 409', () => {
    const e = traduzirErroPg(erroPg('SESSAO_ENCERRADA')) as ErroNegocio;
    expect(e).toBeInstanceOf(ErroNegocio);
    expect([e.codigo, e.status]).toEqual(['SESSAO_ENCERRADA', 409]);
  });

  it('P0001 com detail MESA_BLOQUEADA -> 423', () => {
    const e = traduzirErroPg(erroPg('MESA_BLOQUEADA')) as ErroNegocio;
    expect([e.codigo, e.status]).toEqual(['MESA_BLOQUEADA', 423]);
  });

  it('P0001 sem detail -> erro de negócio 400 (mensagem da função)', () => {
    const e = traduzirErroPg(erroPg(null)) as ErroNegocio;
    expect([e.codigo, e.status]).toEqual(['ERRO_NEGOCIO', 400]);
  });

  it('lê o erro do driver dentro de cause (drizzle)', () => {
    const e = traduzirErroPg(Object.assign(new Error('Failed query'), { cause: erroPg('SESSAO_ENCERRADA') })) as ErroNegocio;
    expect(e.codigo).toBe('SESSAO_ENCERRADA');
  });

  it('outros erros do Postgres não viram erro de negócio', () => {
    expect(traduzirErroPg(erroPg(null, '42P01'))).not.toBeInstanceOf(ErroNegocio);
  });
});
