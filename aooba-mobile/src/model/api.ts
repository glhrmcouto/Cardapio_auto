import type { AcessoMesa, ContaCliente, PedidoCriado, ProdutoMenu, SessaoAtual, StatusSolicitacao } from './types';
import type { ItemCarrinho } from './carrinho';
import { itensParaApi } from './carrinho';

export type CodigoErroApi = 'SESSAO_ENCERRADA' | 'MESA_BLOQUEADA' | 'DADOS_INVALIDOS' | 'ERRO_NEGOCIO' | 'ERRO_INTERNO' | 'SEM_CONEXAO' | 'DESCONHECIDO';

export class ErroApi extends Error {
  constructor(
    message: string,
    public readonly codigo: CodigoErroApi,
    public readonly status = 0,
  ) {
    super(message);
  }
}

export const ehSessaoEncerrada = (e: unknown) => e instanceof ErroApi && e.codigo === 'SESSAO_ENCERRADA';
export const ehMesaBloqueada = (e: unknown) => e instanceof ErroApi && e.codigo === 'MESA_BLOQUEADA';

/** O que os ViewModels precisam do backend. Os testes implementam isto com um fake. */
export interface CardapioApi {
  produtos(): Promise<ProdutoMenu[]>;
  statusMesa(a: AcessoMesa): Promise<'liberada' | 'bloqueada'>;
  sessaoAtual(a: AcessoMesa): Promise<SessaoAtual | null>;
  abrirSessao(a: AcessoMesa): Promise<SessaoAtual>;
  /** Pede ao garçom para confirmar que `nome` está na mesa. Mesa já liberada responde 'aprovada'. */
  solicitarEntrada(a: AcessoMesa, p: { clienteId: string; nome: string }): Promise<StatusSolicitacao>;
  /** Decisão mais recente do garçom para esta pessoa na mesa, ou null se nunca pediu. */
  statusSolicitacao(a: AcessoMesa, clienteId: string): Promise<StatusSolicitacao | null>;
  criarPedido(p: { acesso: AcessoMesa; itens: ItemCarrinho[]; clienteNome: string; clienteId: string; tokenSessao: string | null }): Promise<PedidoCriado>;
  conta(p: { acesso: AcessoMesa; clienteId: string | null; tokenSessao: string | null }): Promise<ContaCliente>;
  fecharMinhaParte(p: { acesso: AcessoMesa; clienteId: string; aceitaTaxa: boolean }): Promise<{ valor_total: number }>;
  fecharContaToda(p: { acesso: AcessoMesa; tokenSessao: string | null }): Promise<void>;
}

const TIMEOUT_MS = 15000;
const MSG_SEM_CONEXAO = 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';

export class AooobaApi implements CardapioApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async chamar<T>(caminho: string, init?: { method?: 'GET' | 'POST'; corpo?: unknown }): Promise<T> {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
    let resposta: Response;
    try {
      resposta = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${caminho}`, {
        method: init?.method ?? 'GET',
        headers: init?.corpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: init?.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
        signal: controle.signal,
      });
    } catch {
      throw new ErroApi(MSG_SEM_CONEXAO, 'SEM_CONEXAO');
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = null;
    try {
      json = await resposta.json();
    } catch {
      // corpo vazio ou não-JSON
    }

    if (!resposta.ok) {
      const e = (json ?? {}) as { codigo?: CodigoErroApi; mensagem?: string };
      throw new ErroApi(e.mensagem || 'Não foi possível concluir a operação. Tente de novo.', e.codigo ?? 'DESCONHECIDO', resposta.status);
    }
    return json as T;
  }

  produtos() {
    return this.chamar<ProdutoMenu[]>('/api/produtos');
  }

  async statusMesa({ mesa, token }: AcessoMesa) {
    const r = await this.chamar<{ status: 'liberada' | 'bloqueada' }>(`/api/mesas/${mesa}/status?t=${encodeURIComponent(token)}`);
    return r.status;
  }

  async sessaoAtual({ mesa, token }: AcessoMesa) {
    const r = await this.chamar<{ sessao: SessaoAtual | null }>(`/api/mesas/${mesa}/sessao?t=${encodeURIComponent(token)}`);
    return r.sessao;
  }

  async abrirSessao({ mesa, token }: AcessoMesa) {
    const r = await this.chamar<{ sessao: SessaoAtual }>(`/api/mesas/${mesa}/sessao`, { method: 'POST', corpo: { t: token } });
    return r.sessao;
  }

  async solicitarEntrada({ mesa, token }: AcessoMesa, p: { clienteId: string; nome: string }) {
    const r = await this.chamar<{ status: StatusSolicitacao }>(`/api/mesas/${mesa}/solicitacao`, {
      method: 'POST',
      corpo: { t: token, clienteId: p.clienteId, nome: p.nome },
    });
    return r.status;
  }

  async statusSolicitacao({ mesa, token }: AcessoMesa, clienteId: string) {
    const r = await this.chamar<{ status: StatusSolicitacao | null }>(
      `/api/mesas/${mesa}/solicitacao?t=${encodeURIComponent(token)}&clienteId=${encodeURIComponent(clienteId)}`,
    );
    return r.status;
  }

  async criarPedido(p: Parameters<CardapioApi['criarPedido']>[0]) {
    const r = await this.chamar<{ pedido: PedidoCriado }>('/api/pedidos', {
      method: 'POST',
      corpo: {
        mesa: p.acesso.mesa,
        token: p.acesso.token,
        itens: itensParaApi(p.itens),
        clienteNome: p.clienteNome,
        clienteId: p.clienteId,
        tokenSessao: p.tokenSessao,
      },
    });
    return r.pedido;
  }

  async conta(p: Parameters<CardapioApi['conta']>[0]) {
    const r = await this.chamar<{ conta: ContaCliente }>('/api/conta', {
      method: 'POST',
      corpo: { mesa: p.acesso.mesa, token: p.acesso.token, clienteId: p.clienteId, tokenSessao: p.tokenSessao },
    });
    return r.conta;
  }

  fecharMinhaParte(p: Parameters<CardapioApi['fecharMinhaParte']>[0]) {
    return this.chamar<{ valor_total: number }>('/api/conta/fechar-parte', {
      method: 'POST',
      corpo: { mesa: p.acesso.mesa, token: p.acesso.token, clienteId: p.clienteId, aceitaTaxa: p.aceitaTaxa },
    });
  }

  async fecharContaToda(p: Parameters<CardapioApi['fecharContaToda']>[0]) {
    await this.chamar('/api/conta/fechar', { method: 'POST', corpo: { mesa: p.acesso.mesa, token: p.acesso.token, tokenSessao: p.tokenSessao } });
  }
}
