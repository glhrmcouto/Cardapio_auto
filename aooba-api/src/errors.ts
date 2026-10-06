export type CodigoErro = 'SESSAO_ENCERRADA' | 'MESA_BLOQUEADA' | 'DADOS_INVALIDOS' | 'ERRO_NEGOCIO';

/** Erro esperado (regra de negócio). A mensagem é segura para mostrar ao cliente. */
export class ErroNegocio extends Error {
  constructor(
    message: string,
    public readonly codigo: CodigoErro = 'ERRO_NEGOCIO',
    public readonly status = 400,
  ) {
    super(message);
  }
}

const STATUS_POR_CODIGO: Record<string, number> = { SESSAO_ENCERRADA: 409, MESA_BLOQUEADA: 423 };

interface ErroDriver {
  code?: string;
  message?: string;
  detail?: string | null;
  cause?: unknown;
}

/**
 * Converte o erro do Postgres. As funções do banco usam `raise exception ... using detail = 'CODIGO'`
 * (SQLSTATE P0001); só essas viram erro de negócio. Qualquer outra coisa (conexão, SQL) segue como erro
 * genérico e vira 500 sem vazar detalhes.
 */
export function traduzirErroPg(erro: unknown): Error {
  const e = erro as ErroDriver;
  // o drizzle pode embrulhar o erro do driver em `cause`
  const origem = e?.cause && typeof e.cause === 'object' ? (e.cause as ErroDriver) : e;
  if (origem?.code === 'P0001' && origem.message) {
    const codigo = origem.detail === 'SESSAO_ENCERRADA' || origem.detail === 'MESA_BLOQUEADA' ? origem.detail : 'ERRO_NEGOCIO';
    return new ErroNegocio(origem.message, codigo, STATUS_POR_CODIGO[codigo] ?? 400);
  }
  return erro instanceof Error ? erro : new Error(String(erro));
}
