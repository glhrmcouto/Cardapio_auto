# AOOBA! BAR — Cardápio Digital (React + TypeScript)

Migração do projeto original (`../Cardapio_auto`, HTML/JS puro) para **Vite + React 18 + TypeScript (strict)**.
O backend não mudou: mesmo Supabase (Postgres + RLS + RPCs + Realtime). As migrações SQL continuam em `supabase/`.

## Rodar

```bash
npm install
cp .env.example .env      # URL + chave publicável do Supabase (pública por design; nunca a service_role)
npm run dev               # http://localhost:5173
npm run build             # tsc + vite build -> dist/
npm test                  # Vitest (79 testes)
npm run typecheck
```

## Rotas

| Rota | Tela | Acesso |
|---|---|---|
| `/` (e `/index.html`) | Cardápio do cliente (`?mesa=N&t=TOKEN` do QR) | público |
| `/balcao` | Balcão | login |
| `/garcom` | Garçom (mobile) — cliente Supabase próprio | garcom/balcao/admin |
| `/admin` | Cardápio + taxa de serviço | admin |
| `/mesas` | Mesas e tokens | admin |
| `/relatorios` | Relatórios + backup ZIP | admin |
| `/gerar-qrcodes` | QR codes imprimíveis | admin |

As URLs antigas com `.html` continuam funcionando (QR codes já impressos apontam para `/index.html?mesa=..&t=..`).
`netlify.toml` faz o fallback de SPA.

## Estrutura

```
src/
  lib/          types, shared (formatação), carrinho, sessaoCliente (regras da trava de sessão), contas (RPCs de conta), backup, supabase
  auth/         RequireAuth (login + papel na tabela perfis)
  hooks/        useControleMesas, useBeep, useContaAtiva
  components/   Modal, Toast, AdminLayout, ContaViews, ConfirmarSenha, Feedback
  pages/        uma por tela; balcao/, garcom/, cardapio/ com os subcomponentes
  styles/       CSS original, reaproveitado sem mudanças
  test/         setup do Vitest e Supabase falso
```

## Testes

- **Unitários (puros):** carrinho, decisões da sessão da mesa, storage, transições de Realtime do balcão, encerrar sessão (com/sem saldo), histórico, novo pedido.
- **Componente/integração:** `RequireAuth` (papéis, login) e Cardápio (acesso bloqueado, boas-vindas, mesa bloqueada, confirmar entrada, conta encerrada, carrinho, criar_pedido, `SESSAO_ENCERRADA`).
- Ainda **não cobertos**: telas admin/mesas/relatórios, Balcão e Garçom como página inteira, e um teste E2E contra um Supabase real (sugestão: Playwright num projeto Supabase de sandbox).

## Pendências / atenção

- Não testei contra o Supabase real nem no navegador; validado por `tsc`, `vite build` e Vitest com Supabase falso. Faça um teste manual de cada fluxo antes de publicar.
- `window.alert/confirm` nativos foram mantidos como no original.
- O CSS de todas as telas é global depois de carregado (como antes, cada tela importa o seu).
- Se o bar trocar de domínio, atualize as tags Open Graph/canonical em `index.html`.
