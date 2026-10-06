import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import type { ClienteRepository } from './domain.js';
import { ErroNegocio } from './errors.js';

const mesa = z.coerce.number().int().positive();
const token = z.string().min(1).max(200);
const uuid = z.string().uuid();

const itemSchema = z.object({
  produtoId: z.number().int().positive(),
  quantidade: z.number().int().positive().max(99),
  compartilhado: z.boolean().default(false),
});

const credencial = z.object({ mesa, token });

const schemas = {
  mesaQuery: z.object({ t: token }),
  abrirSessao: z.object({ t: token }),
  pedido: z.object({
    mesa,
    token,
    itens: z.array(itemSchema).min(1).max(50),
    clienteNome: z.string().trim().min(1).max(20),
    clienteId: uuid,
    tokenSessao: z.string().min(1).nullable().default(null),
  }),
  conta: credencial.extend({ clienteId: uuid.nullable().default(null), tokenSessao: z.string().min(1).nullable().default(null) }),
  fecharParcial: credencial.extend({ clienteId: uuid, aceitaTaxa: z.boolean().default(true) }),
  pedirFechamento: credencial.extend({ tokenSessao: z.string().min(1).nullable().default(null) }),
};

/** Envolve handler async para o Express 4 repassar rejeições ao middleware de erro. */
const assincrono =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function criarApp(repo: ClienteRepository, opcoes: { corsOrigins?: string[] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: opcoes.corsOrigins?.length ? opcoes.corsOrigins : false }));
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/saude', (_req, res) => {
    res.json({ ok: true });
  });

  // ---- cardápio (público, igual à leitura anônima de `produtos` no Supabase) ----
  app.get(
    '/api/produtos',
    assincrono(async (_req, res) => {
      res.json(await repo.listarProdutos());
    }),
  );

  // ---- mesa / sessão ----
  app.get(
    '/api/mesas/:mesa/status',
    assincrono(async (req, res) => {
      const c = credencial.parse({ mesa: req.params.mesa, token: req.query.t });
      res.json({ status: await repo.statusDaMesa(c) });
    }),
  );

  // Só LÊ: nunca cria sessão. `sessao` é null quando a mesa não tem sessão aberta.
  app.get(
    '/api/mesas/:mesa/sessao',
    assincrono(async (req, res) => {
      const c = credencial.parse({ mesa: req.params.mesa, token: req.query.t });
      res.json({ sessao: await repo.sessaoAtual(c) });
    }),
  );

  // Único caminho de criação de sessão — o app só chama sob toque explícito em "Iniciar pedido".
  app.post(
    '/api/mesas/:mesa/sessao',
    assincrono(async (req, res) => {
      const body = schemas.abrirSessao.parse(req.body);
      const c = credencial.parse({ mesa: req.params.mesa, token: body.t });
      res.status(201).json({ sessao: await repo.abrirSessao(c) });
    }),
  );

  // ---- pedido e conta (POST: carregam o token de sessão, que não deve ir em URL) ----
  app.post(
    '/api/pedidos',
    assincrono(async (req, res) => {
      const body = schemas.pedido.parse(req.body);
      res.status(201).json({ pedido: await repo.criarPedido(body) });
    }),
  );

  app.post(
    '/api/conta',
    assincrono(async (req, res) => {
      res.json({ conta: await repo.contaDaMesa(schemas.conta.parse(req.body)) });
    }),
  );

  app.post(
    '/api/conta/fechar-parte',
    assincrono(async (req, res) => {
      res.json(await repo.fecharParcial(schemas.fecharParcial.parse(req.body)));
    }),
  );

  app.post(
    '/api/conta/fechar',
    assincrono(async (req, res) => {
      res.status(201).json(await repo.pedirFechamento(schemas.pedirFechamento.parse(req.body)));
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
  });

  const tratarErro: ErrorRequestHandler = (erro, _req, res, _next) => {
    if (erro instanceof ZodError) {
      res.status(400).json({ codigo: 'DADOS_INVALIDOS', mensagem: 'Dados inválidos.', campos: erro.issues.map((i) => i.path.join('.')) });
      return;
    }
    if (erro instanceof ErroNegocio) {
      res.status(erro.status).json({ codigo: erro.codigo, mensagem: erro.message });
      return;
    }
    if ((erro as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ codigo: 'DADOS_INVALIDOS', mensagem: 'JSON inválido.' });
      return;
    }
    console.error('Erro inesperado:', erro);
    res.status(500).json({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' });
  };
  app.use(tratarErro);

  return app;
}
