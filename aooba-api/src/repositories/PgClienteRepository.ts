import { asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { produtos } from '../db/schema.js';
import { traduzirErroPg } from '../errors.js';
import type { ClienteRepository, Credencial, PedidoCriado, SessaoAtual } from '../domain.js';

/**
 * As regras (token de mesa/sessão, trava de mesa bloqueada, rateio, taxa de serviço) vivem em funções
 * PL/pgSQL do Supabase e NÃO foram duplicadas aqui: a API só as chama com a conexão do servidor.
 * Leituras simples (produtos) usam o query builder do Drizzle.
 */
export class PgClienteRepository implements ClienteRepository {
  constructor(private readonly db: Db) {}

  /** Executa a consulta e devolve a primeira linha, traduzindo erros do Postgres. */
  private async linha<T>(consulta: SQL): Promise<T> {
    try {
      const linhas = (await this.db.execute(consulta)) as unknown as T[];
      return linhas[0];
    } catch (erro) {
      throw traduzirErroPg(erro);
    }
  }

  async listarProdutos() {
    return this.db
      .select({ id: produtos.id, nome: produtos.nome, descricao: produtos.descricao, preco: produtos.preco, categoria: produtos.categoria })
      .from(produtos)
      .where(eq(produtos.ativo, true))
      .orderBy(asc(produtos.ordem));
  }

  async statusDaMesa({ mesa, token }: Credencial) {
    const { r } = await this.linha<{ r: 'liberada' | 'bloqueada' }>(sql`select public.status_da_mesa(${mesa}::int, ${token}::text) as r`);
    return r;
  }

  async sessaoAtual({ mesa, token }: Credencial) {
    const { r } = await this.linha<{ r: SessaoAtual | null }>(sql`select public.sessao_atual(${mesa}::int, ${token}::text) as r`);
    return r;
  }

  async abrirSessao({ mesa, token }: Credencial) {
    const { r } = await this.linha<{ r: SessaoAtual }>(sql`select public.abrir_sessao(${mesa}::int, ${token}::text) as r`);
    return r;
  }

  async criarPedido(p: Parameters<ClienteRepository['criarPedido']>[0]): Promise<PedidoCriado> {
    // O preço NUNCA vem do cliente: a função recalcula a partir de `produtos`.
    const itens = JSON.stringify(p.itens.map((i) => ({ produto_id: i.produtoId, quantidade: i.quantidade, compartilhado: i.compartilhado })));
    const r = await this.linha<{ id: string; mesa: number; total: string; status: string }>(
      sql`select * from public.criar_pedido(${p.mesa}::int, ${p.token}::text, ${itens}::jsonb, ${p.clienteNome}::text, ${p.clienteId}::uuid, ${p.tokenSessao}::text)`,
    );
    return { id: r.id, mesa: r.mesa, total: Number(r.total), status: r.status };
  }

  async contaDaMesa(c: Parameters<ClienteRepository['contaDaMesa']>[0]) {
    const { r } = await this.linha<{ r: unknown }>(
      sql`select public.conta_da_mesa(${c.mesa}::int, ${c.token}::text, ${c.clienteId}::uuid, ${c.tokenSessao}::text) as r`,
    );
    return r;
  }

  async fecharParcial(c: Parameters<ClienteRepository['fecharParcial']>[0]) {
    const r = await this.linha<{ valor_total: string }>(
      sql`select * from public.fechar_parcial(${c.mesa}::int, ${c.token}::text, ${c.clienteId}::uuid, ${c.aceitaTaxa}::boolean)`,
    );
    return { valor_total: Number(r.valor_total) };
  }

  async pedirFechamento(c: Parameters<ClienteRepository['pedirFechamento']>[0]) {
    const r = await this.linha<{ id: string }>(sql`select * from public.pedir_fechamento(${c.mesa}::int, ${c.token}::text, ${c.tokenSessao}::text)`);
    return { id: r.id };
  }
}
