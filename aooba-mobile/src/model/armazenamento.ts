import type { MarcaEncerrada, SessaoGuardada } from './regrasSessao';

/** Armazenamento chave/valor assíncrono (AsyncStorage no app, memória nos testes). */
export interface KeyValueStore {
  get(chave: string): Promise<string | null>;
  set(chave: string, valor: string): Promise<void>;
  remove(chave: string): Promise<void>;
}

export class MemoriaStore implements KeyValueStore {
  private dados = new Map<string, string>();
  async get(chave: string) {
    return this.dados.get(chave) ?? null;
  }
  async set(chave: string, valor: string) {
    this.dados.set(chave, valor);
  }
  async remove(chave: string) {
    this.dados.delete(chave);
  }
}

const SESSAO_KEY = 'aooba_sessao';
const ENCERRADA_KEY = 'aooba_encerrada';
const CLIENTE_ID_KEY = 'aooba_cliente_id';
const CLIENTE_NOME_KEY = 'aooba_cliente_nome';

interface SessaoSalva extends SessaoGuardada {
  mesa: number;
}

/**
 * Tudo que o app lembra no aparelho. NADA aqui autoriza ação: serve só para decidir a tela
 * (ver regrasSessao.ts); o servidor revalida o token de sessão em cada chamada.
 * Falhas de leitura/escrita nunca derrubam o fluxo (viram "não lembro").
 */
export class ArmazenamentoLocal {
  constructor(
    private readonly store: KeyValueStore,
    private readonly gerarId: () => string,
  ) {}

  private async lerJson<T>(chave: string): Promise<T | null> {
    try {
      const bruto = await this.store.get(chave);
      return bruto ? (JSON.parse(bruto) as T) : null;
    } catch {
      return null;
    }
  }

  private async gravar(chave: string, valor: string) {
    try {
      await this.store.set(chave, valor);
    } catch {
      // sem armazenamento: o app segue, só não lembra
    }
  }

  private async apagar(chave: string) {
    try {
      await this.store.remove(chave);
    } catch {
      // idem
    }
  }

  // ---- sessão confirmada neste aparelho ----
  async lerSessao(mesa: number): Promise<SessaoGuardada | null> {
    const s = await this.lerJson<SessaoSalva>(SESSAO_KEY);
    return s && s.mesa === mesa && s.sessaoId && s.tokenSessao ? { sessaoId: s.sessaoId, tokenSessao: s.tokenSessao } : null;
  }

  gravarSessao(mesa: number, sessaoId: string, tokenSessao: string) {
    return this.gravar(SESSAO_KEY, JSON.stringify({ mesa, sessaoId, tokenSessao } satisfies SessaoSalva));
  }

  limparSessao() {
    return this.apagar(SESSAO_KEY);
  }

  // ---- marca de "conta encerrada" ----
  async marcarEncerrada(mesa: number, sessaoId: string | null) {
    if (!sessaoId) return;
    await this.gravar(ENCERRADA_KEY, JSON.stringify({ mesa, sessaoId, encerradaEm: new Date().toISOString() } satisfies MarcaEncerrada));
  }

  /** Devolve a marca só se for desta MESMA mesa. */
  async lerEncerrada(mesa: number): Promise<MarcaEncerrada | null> {
    const m = await this.lerJson<MarcaEncerrada>(ENCERRADA_KEY);
    return m && m.mesa === mesa ? m : null;
  }

  limparEncerrada() {
    return this.apagar(ENCERRADA_KEY);
  }

  // ---- identificação da pessoa (sem login) ----
  async clienteId(): Promise<string> {
    try {
      const existente = await this.store.get(CLIENTE_ID_KEY);
      if (existente) return existente;
    } catch {
      // cai para gerar um novo
    }
    const novo = this.gerarId();
    await this.gravar(CLIENTE_ID_KEY, novo);
    return novo;
  }

  async lerNome(): Promise<string> {
    try {
      return (await this.store.get(CLIENTE_NOME_KEY)) ?? '';
    } catch {
      return '';
    }
  }

  gravarNome(nome: string) {
    return this.gravar(CLIENTE_NOME_KEY, nome);
  }
}
