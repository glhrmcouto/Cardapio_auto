import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import { vi } from 'vitest';

/**
 * API do Supabase mockada com MSW: o cliente REAL do supabase-js faz requisições HTTP
 * (PostgREST em /rest/v1, Auth em /auth/v1) e o MSW responde. Assim os testes conferem
 * URL, método, query string e corpo de cada chamada.
 */
export const BASE = 'http://localhost:54321';
export const server = setupServer();

export interface Chamada {
  tipo: 'rpc' | 'tabela';
  nome: string;
  method: string;
  /** Query string (filtros PostgREST: eq, order, select...). */
  query: Record<string, string>;
  /** Query string completa (para filtros repetidos, ex.: criado_em=gte.X&criado_em=lt.Y). */
  search: URLSearchParams;
  body: unknown;
}

export const chamadas: Chamada[] = [];
export const limparChamadas = () => (chamadas.length = 0);

/** Chamadas registradas de uma RPC. */
export const chamadasRpc = (nome: string) => chamadas.filter((c) => c.tipo === 'rpc' && c.nome === nome);
/** Chamadas registradas de uma tabela, opcionalmente por método (GET/POST/PATCH/DELETE). */
export const chamadasTabela = (nome: string, method?: string) =>
  chamadas.filter((c) => c.tipo === 'tabela' && c.nome === nome && (!method || c.method === method));

/** Erro no formato do PostgREST (o supabase-js expõe message/details/code). */
export class ErroPg {
  constructor(
    public message: string,
    public opts: { details?: string | null; code?: string; status?: number } = {},
  ) {}
  resposta() {
    return HttpResponse.json(
      { message: this.message, details: this.opts.details ?? null, hint: null, code: this.opts.code ?? 'P0001' },
      { status: this.opts.status ?? 400 },
    );
  }
}

type Valor<T> = T | ((entrada: { body: any; query: Record<string, string> }) => T | Promise<T>);

async function lerBody(request: Request): Promise<unknown> {
  const texto = await request.clone().text();
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

async function resolver<T>(valor: Valor<T>, entrada: { body: unknown; query: Record<string, string> }): Promise<T> {
  return typeof valor === 'function' ? await (valor as (e: typeof entrada) => T | Promise<T>)(entrada) : valor;
}

export interface EntradaRpc {
  body: unknown;
  query: Record<string, string>;
}

/** Mock de uma RPC: POST /rest/v1/rpc/<nome>. Devolva um valor JSON ou `new ErroPg(...)` (ou uma função disso). */
export function mockRpc(nome: string, resposta: (entrada: EntradaRpc) => unknown): void;
export function mockRpc(nome: string, resposta?: unknown): void;
export function mockRpc(nome: string, resposta: unknown = null): void {
  server.use(
    http.post(`${BASE}/rest/v1/rpc/${nome}`, async ({ request }) => {
      const url = new URL(request.url);
      const query = Object.fromEntries(url.searchParams);
      const body = await lerBody(request);
      chamadas.push({ tipo: 'rpc', nome, method: 'POST', query, search: url.searchParams, body });
      const r = await resolver(resposta, { body, query });
      if (r instanceof ErroPg) return r.resposta();
      return HttpResponse.json((r ?? null) as JsonBodyType);
    }),
  );
}

interface OpcoesTabela {
  /** GET (select). Linhas; com `.single()`/`.maybeSingle()` devolve a 1ª linha. */
  select?: Valor<unknown[] | ErroPg>;
  /** POST (insert). Linhas criadas. */
  insert?: Valor<unknown[] | ErroPg>;
  /** PATCH (update). Linhas atualizadas (só devolvidas se o cliente pediu representation). */
  update?: Valor<unknown[] | ErroPg>;
  /** DELETE. */
  delete?: Valor<unknown[] | ErroPg>;
}

/** Mock de uma tabela em /rest/v1/<tabela> (GET/POST/PATCH/DELETE). */
export function mockTabela(nome: string, opcoes: OpcoesTabela) {
  const tratar = (method: string, valor: Valor<unknown[] | ErroPg> | undefined) =>
    async ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      const query = Object.fromEntries(url.searchParams);
      const body = await lerBody(request);
      chamadas.push({ tipo: 'tabela', nome, method, query, search: url.searchParams, body });

      const linhas = valor === undefined ? [] : await resolver(valor, { body, query });
      if (linhas instanceof ErroPg) return linhas.resposta();

      const accept = request.headers.get('accept') ?? '';
      const prefer = request.headers.get('prefer') ?? '';
      const querObjeto = accept.includes('vnd.pgrst.object');

      if (method !== 'GET' && !prefer.includes('return=representation')) return new HttpResponse(null, { status: 204 });

      if (querObjeto) {
        if (linhas.length === 0) {
          return HttpResponse.json(
            { message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null, code: 'PGRST116' },
            { status: 406 },
          );
        }
        return HttpResponse.json(linhas[0] as JsonBodyType, { status: method === 'POST' ? 201 : 200 });
      }
      return HttpResponse.json(linhas as JsonBodyType, { status: method === 'POST' ? 201 : 200 });
    };

  const url = `${BASE}/rest/v1/${nome}`;
  server.use(
    http.get(url, tratar('GET', opcoes.select)),
    http.post(url, tratar('POST', opcoes.insert)),
    http.patch(url, tratar('PATCH', opcoes.update)),
    http.delete(url, tratar('DELETE', opcoes.delete)),
  );
}

// ---------------------------------------------------------------- autenticação

const AUTH_KEYS = { padrao: 'sb-localhost-auth-token', garcom: 'sb-garcom-auth-token' } as const;

function sessaoFalsa(userId: string, email: string) {
  return {
    access_token: 'header.payload.assinatura',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh',
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
}

/**
 * Deixa o usuário "já logado" (sessão no localStorage, como após um login anterior) e mocka a
 * consulta de papel em `perfis`. `cliente: 'garcom'` usa a chave de sessão própria do garçom.
 */
export function logadoComo(papel: 'admin' | 'balcao' | 'garcom' | null, cliente: 'padrao' | 'garcom' = 'padrao', email = 'user@aooba.com') {
  const sessao = sessaoFalsa('user-1', email);
  localStorage.setItem(AUTH_KEYS[cliente], JSON.stringify(sessao));
  mockTabela('perfis', { select: papel ? [{ papel }] : [] });
  server.use(
    http.get(`${BASE}/auth/v1/user`, () => HttpResponse.json(sessao.user)),
    http.post(`${BASE}/auth/v1/logout`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${BASE}/auth/v1/token`, () => HttpResponse.json(sessao)),
  );
  return sessao;
}

/** Mock do endpoint de login por senha (para testar o formulário). `ok=false` => credenciais inválidas. */
export function mockLogin(ok: boolean, papel: 'admin' | 'balcao' | 'garcom' | null = 'admin') {
  const sessao = sessaoFalsa('user-1', 'user@aooba.com');
  mockTabela('perfis', { select: papel ? [{ papel }] : [] });
  server.use(
    http.post(`${BASE}/auth/v1/token`, async ({ request }) => {
      const body = await lerBody(request);
      const u = new URL(request.url);
      chamadas.push({ tipo: 'tabela', nome: 'auth/token', method: 'POST', query: Object.fromEntries(u.searchParams), search: u.searchParams, body });
      return ok
        ? HttpResponse.json(sessao)
        : HttpResponse.json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, { status: 400 });
    }),
    http.post(`${BASE}/auth/v1/logout`, () => new HttpResponse(null, { status: 204 })),
  );
}

// ---------------------------------------------------------------- realtime

/**
 * O Realtime usa WebSocket; nos testes não há servidor, então trocamos por uma classe inerte
 * (nunca conecta). Os eventos em tempo real são cobertos por testes de transições puras.
 */
export function instalarWebSocketFalso() {
  class WebSocketInerte {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: (() => void) | null = null;
    binaryType = 'arraybuffer';
    constructor(public url: string) {}
    send() {}
    close() {
      this.readyState = 3;
    }
    addEventListener() {}
    removeEventListener() {}
  }
  vi.stubGlobal('WebSocket', WebSocketInerte);
}
