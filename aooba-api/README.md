# aooba-api — API Express + Drizzle ORM

Backend do app mobile (`../aooba-mobile`). Fala com o **mesmo Postgres do Supabase** do `../aooba-react`.
As regras de negócio (token de mesa/sessão, trava de mesa, rateio, taxa de serviço) continuam nas funções SQL de
`../aooba-react/supabase/`; a API as chama via Drizzle (`db.execute(sql...)`) e usa o query builder nas leituras simples.
**Nenhuma regra foi duplicada.** O banco só ganhou a migração `../aooba-react/supabase/025_fila_aprovacao.sql` (fila de
aprovação: o cliente informa o nome e o garçom confirma que ele está na mesa) — rode-a no Supabase antes de usar as rotas `/solicitacao`.

## Rodar

```bash
npm install
cp .env.example .env     # DATABASE_URL do Supabase (Settings > Database). Nunca commitar.
npm run dev              # http://localhost:3333
npm test                 # Vitest + Supertest (26 testes, sem banco)
npm run typecheck
```

## Endpoints (escopo atual: fluxo do cliente)

| Método e rota | Corpo | Função SQL |
|---|---|---|
| `GET /api/produtos` | — | `select` em `produtos` (ativos, por `ordem`) |
| `GET /api/mesas/:mesa/status?t=TOKEN` | — | `status_da_mesa` |
| `GET /api/mesas/:mesa/sessao?t=TOKEN` | — | `sessao_atual` (só lê; `sessao: null` se não houver) |
| `POST /api/mesas/:mesa/sessao` | `{ t }` | `abrir_sessao` |
| `POST /api/mesas/:mesa/solicitacao` | `{ t, clienteId, nome }` | `solicitar_entrada` (fila de aprovação do garçom; exige a migração `025`) |
| `GET /api/mesas/:mesa/solicitacao?t=TOKEN&clienteId=UUID` | — | `status_solicitacao` (`pendente`/`aprovada`/`recusada`, ou `null`) |
| `POST /api/pedidos` | `{ mesa, token, itens[{produtoId, quantidade, compartilhado}], clienteNome, clienteId, tokenSessao }` | `criar_pedido` |
| `POST /api/conta` | `{ mesa, token, clienteId, tokenSessao }` | `conta_da_mesa` |
| `POST /api/conta/fechar-parte` | `{ mesa, token, clienteId, aceitaTaxa }` | `fechar_parcial` |
| `POST /api/conta/fechar` | `{ mesa, token, tokenSessao }` | `pedir_fechamento` |

Erros: `{ codigo, mensagem }`. `SESSAO_ENCERRADA` → 409, `MESA_BLOQUEADA` → 423, dados inválidos → 400,
erro de regra do banco → 400, qualquer outro → 500 genérico (sem vazar detalhe interno).
O preço **nunca** vem do cliente: a função SQL recalcula a partir de `produtos`.

## Estrutura

```
src/
  app.ts                     rotas, validação (zod) e tratamento de erro — recebe o repositório por injeção
  domain.ts                  tipos + interface ClienteRepository (a "porta")
  errors.ts                  ErroNegocio + tradução dos erros do Postgres (SQLSTATE P0001 + detail)
  db/schema.ts, db/client.ts tabelas Drizzle (produtos, mesas) e conexão
  repositories/PgClienteRepository.ts   implementação real (Drizzle + funções SQL)
  server.ts                  sobe o Express
```

## Atenção

- **Não testado contra o banco real** (falta a `DATABASE_URL`): os testes cobrem rotas, validação e tradução de erros com
  repositório falso. Antes de usar, rode cada endpoint uma vez contra um Supabase de sandbox.
- A API conecta como o dono do banco (ignora RLS). Por isso só expõe as funções acima, com validação de entrada; as
  funções continuam exigindo token de mesa e de sessão.
- Segurança que o Supabase dava de graça e **não existe aqui ainda**: rate limit por IP e HTTPS (ponha atrás de um proxy/host com TLS).
- Fora do escopo desta entrega: balcão, garçom, admin e relatórios (continuam no `aooba-react`).
