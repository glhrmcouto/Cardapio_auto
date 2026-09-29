import {
  decidirComSessao,
  decidirSemSessao,
  ehErroMesaBloqueada,
  ehErroSessaoEncerrada,
  gravarSessaoStorage,
  lerContaEncerrada,
  lerSessaoStorage,
  limparContaEncerrada,
  limparSessaoStorage,
  marcarContaEncerrada,
  obterOuCriarClienteId,
} from '../sessaoCliente';

const guardada = { sessaoId: 's1', tokenSessao: 't1' };
const marca = { mesa: '5', session_id: 's-old', encerrada_em: '2026-01-01T00:00:00Z' };

describe('decidirSemSessao', () => {
  it('mesa bloqueada vence tudo, mesmo com sessão guardada ou marca', () => {
    expect(decidirSemSessao({ statusMesa: 'bloqueada', guardada, marca })).toEqual({ tela: 'mesa_bloqueada' });
  });

  it('com sessão guardada nesta aba => conta encerrada usando o id guardado', () => {
    expect(decidirSemSessao({ statusMesa: 'liberada', guardada, marca: null })).toEqual({ tela: 'conta_encerrada', sessaoIdEncerrada: 's1' });
  });

  it('só com a marca do localStorage => conta encerrada usando o id da marca', () => {
    expect(decidirSemSessao({ statusMesa: 'liberada', guardada: null, marca })).toEqual({ tela: 'conta_encerrada', sessaoIdEncerrada: 's-old' });
  });

  it('sem nada guardado => boas-vindas', () => {
    expect(decidirSemSessao({ statusMesa: 'liberada', guardada: null, marca: null })).toEqual({ tela: 'boas_vindas' });
  });

  it('falha ao consultar status (null) não libera boas-vindas se havia sessão', () => {
    expect(decidirSemSessao({ statusMesa: null, guardada, marca: null }).tela).toBe('conta_encerrada');
  });
});

describe('decidirComSessao', () => {
  it('entra direto só se id E token batem com o guardado', () => {
    expect(decidirComSessao({ sessao_id: 's1', token_sessao: 't1' }, guardada)).toBe('entrar');
  });
  it('pede confirmação se o token mudou', () => {
    expect(decidirComSessao({ sessao_id: 's1', token_sessao: 'OUTRO' }, guardada)).toBe('confirmar');
  });
  it('pede confirmação se não havia nada guardado (celular novo)', () => {
    expect(decidirComSessao({ sessao_id: 's1', token_sessao: 't1' }, null)).toBe('confirmar');
  });
});

describe('storage da sessão', () => {
  it('grava e lê a sessão da mesma mesa', () => {
    gravarSessaoStorage('s1', 't1', '5');
    expect(lerSessaoStorage('5')).toEqual(guardada);
  });

  it('não devolve sessão guardada de outra mesa', () => {
    gravarSessaoStorage('s1', 't1', '5');
    expect(lerSessaoStorage('6')).toBeNull();
  });

  it('limpar remove tudo (nunca id sem token)', () => {
    gravarSessaoStorage('s1', 't1', '5');
    limparSessaoStorage();
    expect(lerSessaoStorage('5')).toBeNull();
  });
});

describe('marca de conta encerrada', () => {
  it('grava e lê só para a mesma mesa', () => {
    marcarContaEncerrada('5', 's1');
    expect(lerContaEncerrada('5')?.session_id).toBe('s1');
    expect(lerContaEncerrada('6')).toBeNull();
  });

  it('não grava sem id de sessão nem sem mesa', () => {
    marcarContaEncerrada('5', null);
    marcarContaEncerrada('', 's1');
    expect(lerContaEncerrada('5')).toBeNull();
  });

  it('limpar apaga a marca', () => {
    marcarContaEncerrada('5', 's1');
    limparContaEncerrada();
    expect(lerContaEncerrada('5')).toBeNull();
  });

  it('JSON corrompido não quebra', () => {
    localStorage.setItem('aooba_encerrada', '{nao-json');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(lerContaEncerrada('5')).toBeNull();
  });
});

describe('erros de RPC e cliente', () => {
  it('distingue SESSAO_ENCERRADA e MESA_BLOQUEADA pelo details, não pela mensagem', () => {
    expect(ehErroSessaoEncerrada({ message: 'x', details: 'SESSAO_ENCERRADA' })).toBe(true);
    expect(ehErroSessaoEncerrada({ message: 'SESSAO_ENCERRADA', details: null })).toBe(false);
    expect(ehErroMesaBloqueada({ message: 'x', details: 'MESA_BLOQUEADA' })).toBe(true);
    expect(ehErroMesaBloqueada(null)).toBe(false);
  });

  it('cliente_id é criado uma vez e reaproveitado', () => {
    const a = obterOuCriarClienteId();
    expect(obterOuCriarClienteId()).toBe(a);
  });
});
