import { adicionarItem, alterarQuantidade, itensParaApi, removerItem, totalCarrinho, totalItens } from '../carrinho';
import { formatarPreco } from '../formatar';
import { lerQrDaMesa } from '../qr';
import { decidirComSessao, decidirSemSessao } from '../regrasSessao';
import { ArmazenamentoLocal, MemoriaStore, type KeyValueStore } from '../armazenamento';
import { AooobaApi, ErroApi } from '../api';

describe('lerQrDaMesa', () => {
  it.each([
    ['QR impresso novo', 'https://aooba.netlify.app/?mesa=5&t=abc123'],
    ['QR impresso antigo (.html)', 'https://aooba.netlify.app/index.html?mesa=5&t=abc123'],
    ['link do app', 'aooba://cardapio?mesa=5&t=abc123'],
    ['com espaços em volta', '  https://x/?mesa=5&t=abc123 \n'],
    ['parâmetros em outra ordem e extras', 'https://x/?utm=1&t=abc123&mesa=5#topo'],
  ])('lê %s', (_n, conteudo) => {
    expect(lerQrDaMesa(conteudo)).toEqual({ mesa: 5, token: 'abc123' });
  });

  it.each([
    ['texto qualquer', 'olá mundo'],
    ['sem token', 'https://x/?mesa=5'],
    ['sem mesa', 'https://x/?t=abc'],
    ['mesa zero', 'https://x/?mesa=0&t=abc'],
    ['mesa negativa', 'https://x/?mesa=-3&t=abc'],
    ['mesa não numérica', 'https://x/?mesa=cinco&t=abc'],
    ['mesa decimal', 'https://x/?mesa=5.5&t=abc'],
    ['token vazio', 'https://x/?mesa=5&t='],
    ['vazio', ''],
  ])('recusa %s', (_n, conteudo) => {
    expect(lerQrDaMesa(conteudo)).toBeNull();
  });

  it('decodifica o token', () => {
    expect(lerQrDaMesa('https://x/?mesa=2&t=a%2Bb')).toEqual({ mesa: 2, token: 'a+b' });
  });
});

describe('carrinho', () => {
  it('soma +1 ao repetir o mesmo item e separa o compartilhado', () => {
    let c = adicionarItem([], 1, 'Gin', 20);
    c = adicionarItem(c, 1, 'Gin', 20);
    c = adicionarItem(c, 1, 'Gin', 20, true);
    expect(c).toHaveLength(2);
    expect(c[0].quantidade).toBe(2);
    expect(c[1].compartilhado).toBe(true);
  });

  it('remove a linha ao chegar a zero', () => {
    const c = alterarQuantidade(adicionarItem([], 1, 'Gin', 20), 1, false, -1);
    expect(c).toEqual([]);
  });

  it('removerItem só remove a linha com o mesmo estado de compartilhado', () => {
    const c = adicionarItem(adicionarItem([], 1, 'Narguilé', 80), 1, 'Narguilé', 80, true);
    expect(removerItem(c, 1, true)).toHaveLength(1);
  });

  it('totais', () => {
    const c = alterarQuantidade(adicionarItem(adicionarItem([], 1, 'Gin', 20), 2, 'Chopp', 12.5), 1, false, 1);
    expect(totalCarrinho(c)).toBe(52.5);
    expect(totalItens(c)).toBe(3);
  });

  it('o payload da API não leva preço nem nome', () => {
    expect(itensParaApi(adicionarItem([], 7, 'Gin', 20, true))).toEqual([{ produtoId: 7, quantidade: 1, compartilhado: true }]);
  });
});

describe('formatarPreco', () => {
  it.each([
    [0, 'R$ 0,00'],
    [12.5, 'R$ 12,50'],
    [1234.5, 'R$ 1.234,50'],
    [1000000, 'R$ 1.000.000,00'],
    ['19.9', 'R$ 19,90'],
    [-5, '-R$ 5,00'],
  ])('%s -> %s', (valor, esperado) => {
    expect(formatarPreco(valor)).toBe(esperado);
  });
});

describe('regras de sessão', () => {
  const guardada = { sessaoId: 's1', tokenSessao: 't1' };
  const marca = { mesa: 5, sessaoId: 's0', encerradaEm: '2026-01-01' };

  it('mesa bloqueada vence conta encerrada', () => {
    expect(decidirSemSessao({ statusMesa: 'bloqueada', guardada, marca })).toEqual({ tela: 'mesa_bloqueada' });
  });
  it('sessão guardada que sumiu = conta encerrada', () => {
    expect(decidirSemSessao({ statusMesa: 'liberada', guardada, marca: null })).toEqual({ tela: 'conta_encerrada', sessaoIdEncerrada: 's1' });
  });
  it('só a marca também = conta encerrada', () => {
    expect(decidirSemSessao({ statusMesa: 'liberada', guardada: null, marca })).toEqual({ tela: 'conta_encerrada', sessaoIdEncerrada: 's0' });
  });
  it('cliente novo em mesa livre = boas-vindas', () => {
    expect(decidirSemSessao({ statusMesa: 'liberada', guardada: null, marca: null })).toEqual({ tela: 'boas_vindas' });
  });
  it('entra direto só na MESMA sessão com o MESMO token', () => {
    expect(decidirComSessao({ sessao_id: 's1', token_sessao: 't1' }, guardada)).toBe('entrar');
    expect(decidirComSessao({ sessao_id: 's1', token_sessao: 'outro' }, guardada)).toBe('confirmar');
    expect(decidirComSessao({ sessao_id: 's2', token_sessao: 't1' }, guardada)).toBe('confirmar');
    expect(decidirComSessao({ sessao_id: 's1', token_sessao: 't1' }, null)).toBe('confirmar');
  });
});

describe('ArmazenamentoLocal', () => {
  const novo = (store: KeyValueStore = new MemoriaStore()) => new ArmazenamentoLocal(store, () => 'id-novo');

  it('só devolve a sessão da mesma mesa', async () => {
    const a = novo();
    await a.gravarSessao(5, 's1', 't1');
    expect(await a.lerSessao(5)).toEqual({ sessaoId: 's1', tokenSessao: 't1' });
    expect(await a.lerSessao(6)).toBeNull();
    await a.limparSessao();
    expect(await a.lerSessao(5)).toBeNull();
  });

  it('marca de encerrada só vale para a mesma mesa e ignora sessão vazia', async () => {
    const a = novo();
    await a.marcarEncerrada(5, null);
    expect(await a.lerEncerrada(5)).toBeNull();
    await a.marcarEncerrada(5, 's1');
    expect((await a.lerEncerrada(5))?.sessaoId).toBe('s1');
    expect(await a.lerEncerrada(6)).toBeNull();
  });

  it('clienteId é gerado uma vez e reaproveitado', async () => {
    let n = 0;
    const a = new ArmazenamentoLocal(new MemoriaStore(), () => `id-${++n}`);
    expect(await a.clienteId()).toBe('id-1');
    expect(await a.clienteId()).toBe('id-1');
  });

  it('lembra o nome', async () => {
    const a = novo();
    expect(await a.lerNome()).toBe('');
    await a.gravarNome('Maria');
    expect(await a.lerNome()).toBe('Maria');
  });

  it('falha do storage nunca derruba o fluxo', async () => {
    const quebrado: KeyValueStore = {
      get: () => Promise.reject(new Error('x')),
      set: () => Promise.reject(new Error('x')),
      remove: () => Promise.reject(new Error('x')),
    };
    const a = novo(quebrado);
    await expect(a.gravarSessao(5, 's', 't')).resolves.toBeUndefined();
    expect(await a.lerSessao(5)).toBeNull();
    expect(await a.lerNome()).toBe('');
    expect(await a.clienteId()).toBe('id-novo');
  });

  it('JSON corrompido vira "não lembro"', async () => {
    const store = new MemoriaStore();
    await store.set('aooba_sessao', '{ruim');
    expect(await novo(store).lerSessao(5)).toBeNull();
  });
});

describe('AooobaApi', () => {
  const resposta = (status: number, corpo: unknown) => Promise.resolve(new Response(JSON.stringify(corpo), { status }));

  it('monta URL e corpo do pedido sem preço', async () => {
    const f = jest.fn().mockReturnValue(resposta(201, { pedido: { id: 'p', mesa: 5, total: 40, status: 'pendente' } }));
    const api = new AooobaApi('http://srv:3333/', f as unknown as typeof fetch);
    await api.criarPedido({
      acesso: { mesa: 5, token: 'tk' },
      itens: adicionarItem([], 1, 'Gin', 20),
      clienteNome: 'Maria',
      clienteId: 'cid',
      tokenSessao: 'ts',
    });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://srv:3333/api/pedidos');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      mesa: 5,
      token: 'tk',
      itens: [{ produtoId: 1, quantidade: 1, compartilhado: false }],
      clienteNome: 'Maria',
      clienteId: 'cid',
      tokenSessao: 'ts',
    });
  });

  it('codifica o token na query', async () => {
    const f = jest.fn().mockReturnValue(resposta(200, { status: 'liberada' }));
    await new AooobaApi('http://srv', f as unknown as typeof fetch).statusMesa({ mesa: 3, token: 'a b&c' });
    expect(f.mock.calls[0][0]).toBe('http://srv/api/mesas/3/status?t=a%20b%26c');
  });

  it('sessaoAtual devolve null quando não há sessão', async () => {
    const f = jest.fn().mockReturnValue(resposta(200, { sessao: null }));
    expect(await new AooobaApi('http://srv', f as unknown as typeof fetch).sessaoAtual({ mesa: 3, token: 't' })).toBeNull();
  });

  it('traduz o código de erro do servidor', async () => {
    const f = jest.fn().mockReturnValue(resposta(409, { codigo: 'SESSAO_ENCERRADA', mensagem: 'Esta conta foi encerrada.' }));
    const erro = await new AooobaApi('http://srv', f as unknown as typeof fetch).conta({ acesso: { mesa: 3, token: 't' }, clienteId: null, tokenSessao: 'x' }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect([erro.codigo, erro.status, erro.message]).toEqual(['SESSAO_ENCERRADA', 409, 'Esta conta foi encerrada.']);
  });

  it('rede fora do ar vira SEM_CONEXAO', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const erro = await new AooobaApi('http://srv', f as unknown as typeof fetch).produtos().catch((e) => e);
    expect(erro.codigo).toBe('SEM_CONEXAO');
  });

  it('resposta de erro sem JSON ainda dá mensagem útil', async () => {
    const f = jest.fn().mockReturnValue(Promise.resolve(new Response('<html>502</html>', { status: 502 })));
    const erro = await new AooobaApi('http://srv', f as unknown as typeof fetch).produtos().catch((e) => e);
    expect([erro.codigo, erro.status]).toEqual(['DESCONHECIDO', 502]);
    expect(erro.message).not.toContain('html');
  });
});
