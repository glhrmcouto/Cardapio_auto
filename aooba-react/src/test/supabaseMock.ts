import { vi } from 'vitest';

type Resposta = { data?: unknown; error?: { message: string; details?: string | null; code?: string } | null };

/** Query builder encadeável e "thenable": qualquer .select/.eq/.order... devolve ele mesmo; await resolve com a resposta. */
export function criarQuery(resposta: Resposta) {
  const final = { data: resposta.data ?? null, error: resposta.error ?? null };
  const q: Record<string, unknown> = {};
  const encadeaveis = ['select', 'eq', 'order', 'gte', 'lt', 'range', 'insert', 'update', 'delete', 'in', 'limit'];
  for (const m of encadeaveis) q[m] = vi.fn(() => q);
  q.single = vi.fn(async () => final);
  q.maybeSingle = vi.fn(async () => final);
  q.then = (ok: (v: typeof final) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(final).then(ok, ko);
  return q;
}

export interface OpcoesMock {
  /** Respostas por nome de RPC (valor fixo ou função). */
  rpc?: Record<string, Resposta | ((args: Record<string, unknown>) => Resposta)>;
  /** Respostas por nome de tabela. */
  tabelas?: Record<string, Resposta>;
}

/** Cliente Supabase falso para testes de componente. */
export function criarSupabaseFalso({ rpc = {}, tabelas = {} }: OpcoesMock = {}) {
  const canal = { on: vi.fn(() => canal), subscribe: vi.fn(() => canal) };
  return {
    rpc: vi.fn(async (nome: string, args: Record<string, unknown> = {}) => {
      const r = rpc[nome];
      if (!r) return { data: null, error: null };
      const resp = typeof r === 'function' ? r(args) : r;
      return { data: resp.data ?? null, error: resp.error ?? null };
    }),
    from: vi.fn((tabela: string) => criarQuery(tabelas[tabela] ?? { data: [] })),
    channel: vi.fn(() => canal),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      getUser: vi.fn(async () => ({ data: { user: { email: 'a@b.c' } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => ({})),
    },
  };
}

export type SupabaseFalso = ReturnType<typeof criarSupabaseFalso>;
