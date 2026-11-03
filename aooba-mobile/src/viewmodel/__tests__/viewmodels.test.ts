import { ErroApi, type CardapioApi } from '../../model/api';
import { ArmazenamentoLocal, MemoriaStore } from '../../model/armazenamento';
import type { ContaCliente, ProdutoMenu } from '../../model/types';
import { CardapioViewModel } from '../CardapioViewModel';
import { ContaViewModel } from '../ContaViewModel';
import { INTERVALO_POLL_BLOQUEADA_MS, INTERVALO_POLL_SESSAO_MS, SessaoViewModel } from '../SessaoViewModel';

const acesso = { mesa: 5, token: 'tk' };
const SESSAO = { sessao_id: 's1', token_sessao: 'ts1' };

const gin: ProdutoMenu = { id: 1, nome: 'Gin', descricao: '', preco: 20, categoria: 'drink' };
const narguile: ProdutoMenu = { id: 2, nome: 'Narguilé', descricao: '', preco: 80, categoria: 'narguile' };
const essencia: ProdutoMenu = { id: 3, nome: 'Menta', descricao: '', preco: 5, categoria: 'essencia' };

const contaFalsa = { taxa_servico_percentual: 10, minha_parte: { status: 'em_aberto', subtotal_em_aberto: 100 } } as unknown as ContaCliente;

function apiFalsa(sobrescrever: Partial<CardapioApi> = {}): jest.Mocked<CardapioApi> {
  return {
    produtos: jest.fn().mockResolvedValue([gin, narguile, essencia]),
    statusMesa: jest.fn().mockResolvedValue('liberada'),
    sessaoAtual: jest.fn().mockResolvedValue(null),
    abrirSessao: jest.fn().mockResolvedValue(SESSAO),
    solicitarEntrada: jest.fn().mockResolvedValue('pendente'),
    statusSolicitacao: jest.fn().mockResolvedValue(null),
    criarPedido: jest.fn().mockResolvedValue({ id: 'p', mesa: 5, total: 20, status: 'pendente' }),
    conta: jest.fn().mockResolvedValue(contaFalsa),
    fecharMinhaParte: jest.fn().mockResolvedValue({ valor_total: 110 }),
    fecharContaToda: jest.fn().mockResolvedValue(undefined),
    ...sobrescrever,
  } as jest.Mocked<CardapioApi>;
}

const criadas: SessaoViewModel[] = [];

function montar(api = apiFalsa()) {
  const armazenamento = new ArmazenamentoLocal(new MemoriaStore(), () => 'cliente-1');
  const sessao = new SessaoViewModel(acesso, api, armazenamento);
  criadas.push(sessao);
  return { api, armazenamento, sessao };
}

const erroApi = (codigo: ConstructorParameters<typeof ErroApi>[1], status = 400) => new ErroApi(`erro ${codigo}`, codigo, status);

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  criadas.splice(0).forEach((s) => s.dispose()); // nenhum polling vaza entre testes
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SessaoViewModel — decisão inicial', () => {
  it('mesa livre e cliente novo: boas-vindas, e NÃO abre sessão sozinho', async () => {
    const { api, sessao } = montar();
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('boas_vindas');
    expect(api.abrirSessao).not.toHaveBeenCalled();
  });

  it('só "Iniciar pedido" cria a sessão e libera', async () => {
    const { api, sessao, armazenamento } = montar();
    await sessao.iniciar('scan');
    await sessao.iniciarPedido();
    expect(api.abrirSessao).toHaveBeenCalledTimes(1);
    expect(sessao.getState()).toMatchObject({ tela: 'liberada', sessaoId: 's1', tokenSessao: 'ts1' });
    expect(await armazenamento.lerSessao(5)).toEqual({ sessaoId: 's1', tokenSessao: 'ts1' });
    sessao.dispose();
  });

  it('mesa bloqueada: trava e faz polling até liberar', async () => {
    jest.useFakeTimers();
    const api = apiFalsa({ statusMesa: jest.fn().mockResolvedValue('bloqueada') });
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('mesa_bloqueada');

    api.statusMesa.mockResolvedValue('liberada');
    await jest.advanceTimersByTimeAsync(INTERVALO_POLL_BLOQUEADA_MS);
    expect(sessao.getState().tela).toBe('boas_vindas');
    sessao.dispose();
  });

  it('sessão aberta e aparelho sem ela: pede confirmação antes de entrar', async () => {
    const { api, sessao } = montar(apiFalsa({ sessaoAtual: jest.fn().mockResolvedValue(SESSAO) }));
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('confirmar_entrada');
    expect(api.abrirSessao).not.toHaveBeenCalled();
    await sessao.entrarNaSessao();
    expect(sessao.getState()).toMatchObject({ tela: 'liberada', tokenSessao: 'ts1' });
    sessao.dispose();
  });

  it('cancelar a entrada trava em "entrada_cancelada"', async () => {
    const { sessao } = montar(apiFalsa({ sessaoAtual: jest.fn().mockResolvedValue(SESSAO) }));
    await sessao.iniciar('scan');
    await sessao.cancelarEntrada();
    expect(sessao.getState().tela).toBe('entrada_cancelada');
  });

  it('aparelho que já confirmou a mesma sessão entra direto', async () => {
    const { sessao, armazenamento } = montar(apiFalsa({ sessaoAtual: jest.fn().mockResolvedValue(SESSAO) }));
    await armazenamento.gravarSessao(5, 's1', 'ts1');
    await sessao.iniciar('retomada');
    expect(sessao.getState().tela).toBe('liberada');
    sessao.dispose();
  });

  it('sessão guardada que o servidor não tem mais = conta encerrada (retomada)', async () => {
    const { sessao, armazenamento } = montar();
    await armazenamento.gravarSessao(5, 's1', 'ts1');
    await sessao.iniciar('retomada');
    expect(sessao.getState().tela).toBe('conta_encerrada');
    expect(await armazenamento.lerSessao(5)).toBeNull();
    expect((await armazenamento.lerEncerrada(5))?.sessaoId).toBe('s1');
  });

  it('escanear o QR de novo depois de encerrada começa do zero (boas-vindas)', async () => {
    const { sessao, armazenamento } = montar();
    await armazenamento.gravarSessao(5, 's1', 'ts1');
    await armazenamento.marcarEncerrada(5, 's1');
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('boas_vindas');
  });

  it('mesa bloqueada vence conta encerrada', async () => {
    const api = apiFalsa({ statusMesa: jest.fn().mockResolvedValue('bloqueada') });
    const { sessao, armazenamento } = montar(api);
    await armazenamento.marcarEncerrada(5, 's0');
    await sessao.iniciar('retomada');
    expect(sessao.getState().tela).toBe('mesa_bloqueada');
    sessao.dispose();
  });
});

describe('SessaoViewModel — na dúvida, trava', () => {
  it('rede fora do ar: "sem_conexao" e NUNCA libera nem marca encerrada', async () => {
    const api = apiFalsa({ sessaoAtual: jest.fn().mockRejectedValue(erroApi('SEM_CONEXAO', 0)) });
    const { sessao, armazenamento } = montar(api);
    await armazenamento.gravarSessao(5, 's1', 'ts1');
    await sessao.iniciar('retomada');
    expect(sessao.getState().tela).toBe('sem_conexao');
    expect(await armazenamento.lerEncerrada(5)).toBeNull();
    expect(await armazenamento.lerSessao(5)).not.toBeNull();
  });

  it('sessaoAtual ok mas statusMesa falha: não assume boas-vindas', async () => {
    const api = apiFalsa({ statusMesa: jest.fn().mockRejectedValue(erroApi('SEM_CONEXAO', 0)) });
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('sem_conexao');
  });

  it('QR recusado pelo servidor: "qr_invalido"', async () => {
    const api = apiFalsa({ sessaoAtual: jest.fn().mockRejectedValue(erroApi('ERRO_NEGOCIO')) });
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('qr_invalido');
  });

  it('"Tentar de novo" depois da falha recupera', async () => {
    const api = apiFalsa();
    api.sessaoAtual.mockRejectedValueOnce(erroApi('SEM_CONEXAO', 0));
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('sem_conexao');
    await sessao.iniciar('scan');
    expect(sessao.getState().tela).toBe('boas_vindas');
  });
});

describe('SessaoViewModel — fila de aprovação do garçom', () => {
  const bloqueada = () => apiFalsa({ statusMesa: jest.fn().mockResolvedValue('bloqueada') });
  /** `retomarSolicitacao` roda solta (sem await) depois de `iniciar`; deixa as promessas dela terminarem. */
  const esvaziarFila = () => new Promise<void>((resolver) => setImmediate(() => resolver()));

  it('pede liberação com o nome: o garçom confirma "João está na mesa" e a tela fica pendente', async () => {
    const { api, sessao, armazenamento } = montar(bloqueada());
    await sessao.iniciar('scan');
    await sessao.pedirLiberacao('  João ');
    expect(api.solicitarEntrada).toHaveBeenCalledWith(acesso, { clienteId: 'cliente-1', nome: 'João' });
    expect(sessao.getState()).toMatchObject({ tela: 'mesa_bloqueada', solicitacao: 'pendente', nomeSolicitado: 'João', enviandoSolicitacao: false });
    expect(await armazenamento.lerNome()).toBe('João'); // o cardápio não pergunta de novo
    sessao.dispose();
  });

  it('nome vazio ou grande demais não chama a API e avisa', async () => {
    const { api, sessao } = montar(bloqueada());
    await sessao.iniciar('scan');
    await sessao.pedirLiberacao('   ');
    await sessao.pedirLiberacao('x'.repeat(21));
    expect(api.solicitarEntrada).not.toHaveBeenCalled();
    expect(sessao.getState().aviso?.texto).toContain('Informe seu nome');
    sessao.dispose();
  });

  it('erro ao pedir só avisa e deixa tentar de novo', async () => {
    const api = bloqueada();
    api.solicitarEntrada.mockRejectedValue(erroApi('SEM_CONEXAO', 0));
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.pedirLiberacao('João');
    expect(sessao.getState()).toMatchObject({ solicitacao: null, enviandoSolicitacao: false });
    expect(sessao.getState().aviso?.texto).toContain('erro SEM_CONEXAO');
    sessao.dispose();
  });

  it('garçom aprova: a mesa libera e o polling leva às boas-vindas (sessão só com toque)', async () => {
    jest.useFakeTimers();
    const api = bloqueada();
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.pedirLiberacao('João');

    api.statusMesa.mockResolvedValue('liberada');
    await jest.advanceTimersByTimeAsync(INTERVALO_POLL_BLOQUEADA_MS);
    expect(sessao.getState().tela).toBe('boas_vindas');
    expect(api.abrirSessao).not.toHaveBeenCalled();
    sessao.dispose();
  });

  it('garçom recusa: o polling mostra "recusada" e a pessoa pode pedir de novo', async () => {
    jest.useFakeTimers();
    const api = bloqueada();
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.pedirLiberacao('João');

    api.statusSolicitacao.mockResolvedValue('recusada');
    await jest.advanceTimersByTimeAsync(INTERVALO_POLL_BLOQUEADA_MS);
    expect(sessao.getState()).toMatchObject({ tela: 'mesa_bloqueada', solicitacao: 'recusada' });

    api.statusSolicitacao.mockResolvedValue('pendente');
    await sessao.pedirLiberacao('João');
    expect(api.solicitarEntrada).toHaveBeenCalledTimes(2);
    expect(sessao.getState().solicitacao).toBe('pendente');
    sessao.dispose();
  });

  it('se a mesa já estava liberada ao pedir, segue sem fila', async () => {
    const api = bloqueada();
    api.solicitarEntrada.mockResolvedValue('aprovada');
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    api.statusMesa.mockResolvedValue('liberada');
    await sessao.pedirLiberacao('João');
    expect(sessao.getState().tela).toBe('boas_vindas');
    sessao.dispose();
  });

  it('reabrir a tela retoma um pedido que já está na fila (sem pedir de novo)', async () => {
    const api = bloqueada();
    api.statusSolicitacao.mockResolvedValue('pendente');
    const { sessao, armazenamento } = montar(api);
    await armazenamento.gravarNome('João');
    await sessao.iniciar('retomada');
    await esvaziarFila();
    expect(sessao.getState()).toMatchObject({ tela: 'mesa_bloqueada', solicitacao: 'pendente', nomeSolicitado: 'João' });
    expect(api.solicitarEntrada).not.toHaveBeenCalled();
    sessao.dispose();
  });

  it('erro de rede ao retomar não derruba a tela de mesa bloqueada', async () => {
    const api = bloqueada();
    api.statusSolicitacao.mockRejectedValue(erroApi('SEM_CONEXAO', 0));
    const { sessao } = montar(api);
    await sessao.iniciar('retomada');
    await esvaziarFila();
    expect(sessao.getState()).toMatchObject({ tela: 'mesa_bloqueada', solicitacao: null });
    sessao.dispose();
  });
});

describe('SessaoViewModel — com a conta aberta', () => {
  async function liberada(api = apiFalsa()) {
    const m = montar(api);
    await m.sessao.iniciar('scan');
    await m.sessao.iniciarPedido();
    return m;
  }

  it('iniciar pedido em mesa bloqueada trava em vez de avisar erro', async () => {
    const api = apiFalsa({ abrirSessao: jest.fn().mockRejectedValue(erroApi('MESA_BLOQUEADA', 423)) });
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.iniciarPedido();
    expect(sessao.getState().tela).toBe('mesa_bloqueada');
    sessao.dispose();
  });

  it('falha de rede ao iniciar pedido só avisa e continua nas boas-vindas', async () => {
    const api = apiFalsa({ abrirSessao: jest.fn().mockRejectedValue(erroApi('SEM_CONEXAO', 0)) });
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.iniciarPedido();
    expect(sessao.getState().tela).toBe('boas_vindas');
    expect(sessao.getState().aviso?.texto).toContain('erro SEM_CONEXAO');
    expect(sessao.getState().abrindo).toBe(false);
  });

  it('polling percebe que a conta foi fechada pelo balcão', async () => {
    jest.useFakeTimers();
    const api = apiFalsa();
    const { sessao, armazenamento } = montar(api);
    await sessao.iniciar('scan');
    await sessao.iniciarPedido();
    api.sessaoAtual.mockResolvedValue(null);
    await jest.advanceTimersByTimeAsync(INTERVALO_POLL_SESSAO_MS);
    expect(sessao.getState().tela).toBe('conta_encerrada');
    expect((await armazenamento.lerEncerrada(5))?.sessaoId).toBe('s1');
    sessao.dispose();
  });

  it('polling também percebe sessão trocada (fechou e abriram outra)', async () => {
    jest.useFakeTimers();
    const api = apiFalsa();
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.iniciarPedido();
    api.sessaoAtual.mockResolvedValue({ sessao_id: 's2', token_sessao: 'ts2' });
    await jest.advanceTimersByTimeAsync(INTERVALO_POLL_SESSAO_MS);
    expect(sessao.getState().tela).toBe('conta_encerrada');
    sessao.dispose();
  });

  it('erro de rede no polling NÃO derruba a tela', async () => {
    jest.useFakeTimers();
    const api = apiFalsa();
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.iniciarPedido();
    api.sessaoAtual.mockRejectedValue(erroApi('SEM_CONEXAO', 0));
    await jest.advanceTimersByTimeAsync(INTERVALO_POLL_SESSAO_MS * 3);
    expect(sessao.getState().tela).toBe('liberada');
    sessao.dispose();
  });

  it('dispose para o polling', async () => {
    jest.useFakeTimers();
    const api = apiFalsa();
    const { sessao } = montar(api);
    await sessao.iniciar('scan');
    await sessao.iniciarPedido();
    const chamadas = api.sessaoAtual.mock.calls.length;
    sessao.dispose();
    await jest.advanceTimersByTimeAsync(INTERVALO_POLL_SESSAO_MS * 3);
    expect(api.sessaoAtual.mock.calls.length).toBe(chamadas);
  });

  it('tratarErro: SESSAO_ENCERRADA vira conta encerrada; erro comum não é tratado', async () => {
    const { sessao } = await liberada();
    expect(await sessao.tratarErro(erroApi('SEM_CONEXAO', 0))).toBe(false);
    expect(sessao.getState().tela).toBe('liberada');
    expect(await sessao.tratarErro(erroApi('SESSAO_ENCERRADA', 409))).toBe(true);
    expect(sessao.getState().tela).toBe('conta_encerrada');
    expect(sessao.getState().tokenSessao).toBeNull();
    sessao.dispose();
  });

  it('notifica quem assinou a cada mudança', async () => {
    const { sessao } = montar();
    const ouvinte = jest.fn();
    const sair = sessao.subscribe(ouvinte);
    await sessao.iniciar('scan');
    expect(ouvinte).toHaveBeenCalled();
    const n = ouvinte.mock.calls.length;
    sair();
    await sessao.iniciar('scan');
    expect(ouvinte.mock.calls.length).toBe(n);
  });
});

describe('CardapioViewModel', () => {
  async function pronto(api = apiFalsa()) {
    const m = montar(api);
    await m.sessao.iniciar('scan');
    await m.sessao.iniciarPedido();
    const cardapio = new CardapioViewModel(acesso, api, m.armazenamento, m.sessao);
    return { ...m, cardapio };
  }

  it('só carrega o menu em aoLiberar() e pede o nome se ainda não tem', async () => {
    const { api, cardapio } = await pronto();
    expect(api.produtos).not.toHaveBeenCalled();
    await cardapio.aoLiberar();
    expect(cardapio.getState().produtos).toHaveLength(3);
    expect(cardapio.getState().nomeAberto).toBe(true);
    expect(cardapio.porCategoria('drink')).toEqual([gin]);
  });

  it('nome já salvo não pede de novo', async () => {
    const { cardapio, armazenamento } = await pronto();
    await armazenamento.gravarNome('Maria');
    await cardapio.aoLiberar();
    expect(cardapio.getState()).toMatchObject({ clienteNome: 'Maria', nomeAberto: false });
  });

  it('erro ao carregar o menu liga erroMenu e permite tentar de novo', async () => {
    const api = apiFalsa();
    api.produtos.mockRejectedValueOnce(erroApi('SEM_CONEXAO', 0));
    const { cardapio } = await pronto(api);
    await cardapio.carregarMenu();
    expect(cardapio.getState()).toMatchObject({ erroMenu: true, carregandoMenu: false, produtos: [] });
    await cardapio.carregarMenu();
    expect(cardapio.getState()).toMatchObject({ erroMenu: false });
    expect(cardapio.getState().produtos).toHaveLength(3);
  });

  it('nome é obrigatório enquanto não existe; confirma com trim e máx. 20', async () => {
    const { cardapio, armazenamento } = await pronto();
    await cardapio.aoLiberar();
    cardapio.fecharNome();
    expect(cardapio.getState().nomeAberto).toBe(true);
    expect(await cardapio.confirmarNome('   ')).toBe(false);
    expect(await cardapio.confirmarNome('  Maria da Silva Sauro Rex Junior  ')).toBe(true);
    expect(cardapio.getState().clienteNome).toBe('Maria da Silva Sauro');
    expect(await armazenamento.lerNome()).toBe('Maria da Silva Sauro');
    expect(cardapio.getState().nomeAberto).toBe(false);
  });

  it('essência entra com preço 0 e só narguilé pode ser dividido', async () => {
    const { cardapio } = await pronto();
    cardapio.adicionar(essencia, true);
    cardapio.adicionar(gin, true);
    cardapio.adicionar(narguile, true);
    const [e, g, n] = cardapio.getState().carrinho;
    expect([e.preco, e.compartilhado]).toEqual([0, false]);
    expect([g.preco, g.compartilhado]).toEqual([20, false]);
    expect([n.preco, n.compartilhado]).toEqual([80, true]);
    expect(cardapio.total).toBe(100);
    expect(cardapio.getState().carrinhoAberto).toBe(true);
  });

  it('quantidade e remoção', async () => {
    const { cardapio } = await pronto();
    cardapio.adicionar(gin);
    const item = cardapio.getState().carrinho[0];
    cardapio.alterarQuantidade(item, 2);
    expect(cardapio.quantidadeTotal).toBe(3);
    cardapio.remover(item);
    expect(cardapio.getState().carrinho).toEqual([]);
  });

  it('carrinho vazio não chama a API', async () => {
    const { api, cardapio } = await pronto();
    await cardapio.fazerPedido();
    expect(api.criarPedido).not.toHaveBeenCalled();
    expect(cardapio.getState().aviso?.texto).toMatch(/pelo menos um item/);
  });

  it('sem nome: abre o modal e não envia', async () => {
    const { api, cardapio } = await pronto();
    cardapio.adicionar(gin);
    await cardapio.fazerPedido();
    expect(api.criarPedido).not.toHaveBeenCalled();
    expect(cardapio.getState().nomeAberto).toBe(true);
  });

  it('pedido ok: envia token de sessão e clienteId, limpa carrinho e confirma', async () => {
    const { api, cardapio } = await pronto();
    await cardapio.aoLiberar();
    await cardapio.confirmarNome('Maria');
    cardapio.adicionar(gin);
    await cardapio.fazerPedido();
    expect(api.criarPedido).toHaveBeenCalledWith({
      acesso,
      itens: [{ produtoId: 1, nome: 'Gin', preco: 20, quantidade: 1, compartilhado: false }],
      clienteNome: 'Maria',
      clienteId: 'cliente-1',
      tokenSessao: 'ts1',
    });
    expect(cardapio.getState()).toMatchObject({ carrinho: [], confirmado: true, enviando: false, carrinhoAberto: false });
    cardapio.dispensarConfirmacao();
    expect(cardapio.getState().confirmado).toBe(false);
  });

  it('falha de rede: mantém o carrinho e avisa', async () => {
    const api = apiFalsa({ criarPedido: jest.fn().mockRejectedValue(erroApi('SEM_CONEXAO', 0)) });
    const { cardapio } = await pronto(api);
    await cardapio.aoLiberar();
    await cardapio.confirmarNome('Maria');
    cardapio.adicionar(gin);
    await cardapio.fazerPedido();
    expect(cardapio.getState().carrinho).toHaveLength(1);
    expect(cardapio.getState()).toMatchObject({ confirmado: false, enviando: false });
    expect(cardapio.getState().aviso?.texto).toContain('SEM_CONEXAO');
  });

  it('sessão encerrada no pedido: trava a sessão e mantém o carrinho', async () => {
    const api = apiFalsa({ criarPedido: jest.fn().mockRejectedValue(erroApi('SESSAO_ENCERRADA', 409)) });
    const { cardapio, sessao } = await pronto(api);
    await cardapio.aoLiberar();
    await cardapio.confirmarNome('Maria');
    cardapio.adicionar(gin);
    await cardapio.fazerPedido();
    expect(sessao.getState().tela).toBe('conta_encerrada');
    expect(cardapio.getState().carrinho).toHaveLength(1);
    sessao.dispose();
  });

  it('não envia duas vezes ao tocar rápido', async () => {
    let liberar!: () => void;
    const api = apiFalsa({ criarPedido: jest.fn().mockReturnValue(new Promise((r) => (liberar = () => r({ id: 'p', mesa: 5, total: 20, status: 'pendente' })))) });
    const { cardapio } = await pronto(api);
    await cardapio.aoLiberar();
    await cardapio.confirmarNome('Maria');
    cardapio.adicionar(gin);
    const a = cardapio.fazerPedido();
    const b = cardapio.fazerPedido();
    await Promise.resolve();
    liberar();
    await Promise.all([a, b]);
    expect(api.criarPedido).toHaveBeenCalledTimes(1);
  });
});

describe('ContaViewModel', () => {
  async function pronto(api = apiFalsa()) {
    const m = montar(api);
    await m.sessao.iniciar('scan');
    await m.sessao.iniciarPedido();
    const conta = new ContaViewModel(acesso, api, m.sessao, () => m.armazenamento.clienteId());
    return { ...m, conta };
  }

  it('abre e consulta a conta com token de sessão e clienteId', async () => {
    const { api, conta } = await pronto();
    await conta.abrir();
    expect(api.conta).toHaveBeenCalledWith({ acesso, clienteId: 'cliente-1', tokenSessao: 'ts1' });
    expect(conta.getState()).toMatchObject({ aberta: true, status: null, conta: contaFalsa });
  });

  it('prévia de "minha parte" com e sem taxa', async () => {
    const { conta } = await pronto();
    await conta.abrir();
    expect(conta.previaMinhaParte).toEqual({ subtotal: 100, taxa: 10, total: 110 });
    conta.definirAceitaTaxa(false);
    expect(conta.previaMinhaParte).toEqual({ subtotal: 100, taxa: 0, total: 100 });
  });

  it('erro ao consultar mostra a mensagem', async () => {
    const api = apiFalsa({ conta: jest.fn().mockRejectedValue(erroApi('SEM_CONEXAO', 0)) });
    const { conta } = await pronto(api);
    await conta.abrir();
    expect(conta.getState().status).toContain('SEM_CONEXAO');
    expect(conta.getState().conta).toBeNull();
  });

  it('sessão encerrada ao consultar: fecha o modal e trava a sessão', async () => {
    const api = apiFalsa({ conta: jest.fn().mockRejectedValue(erroApi('SESSAO_ENCERRADA', 409)) });
    const { conta, sessao } = await pronto(api);
    await conta.abrir();
    expect(conta.getState().aberta).toBe(false);
    expect(sessao.getState().tela).toBe('conta_encerrada');
    sessao.dispose();
  });

  it('fechar minha parte sem taxa envia aceitaTaxa=false e recarrega a conta', async () => {
    const { api, conta } = await pronto();
    await conta.abrir();
    conta.definirAceitaTaxa(false);
    await conta.fecharMinhaParte();
    expect(api.fecharMinhaParte).toHaveBeenCalledWith({ acesso, clienteId: 'cliente-1', aceitaTaxa: false });
    expect(api.conta).toHaveBeenCalledTimes(2);
    expect(conta.getState().aviso?.texto).toContain('R$ 110,00');
  });

  it('fechar a conta toda fecha o modal e avisa o garçom', async () => {
    const { api, conta } = await pronto();
    await conta.abrir();
    await conta.fecharContaToda();
    expect(api.fecharContaToda).toHaveBeenCalledWith({ acesso, tokenSessao: 'ts1' });
    expect(conta.getState()).toMatchObject({ aberta: false, fechandoConta: false });
    expect(conta.getState().aviso?.texto).toMatch(/garçom já foi avisado/);
  });

  it('falha ao fechar a conta toda mantém o modal aberto', async () => {
    const api = apiFalsa({ fecharContaToda: jest.fn().mockRejectedValue(erroApi('SEM_CONEXAO', 0)) });
    const { conta } = await pronto(api);
    await conta.abrir();
    await conta.fecharContaToda();
    expect(conta.getState().aberta).toBe(true);
    expect(conta.getState().aviso?.texto).toContain('SEM_CONEXAO');
  });
});
