# Refatoração para React + TypeScript — guia de continuação

Documento de passagem de bastão. Leia junto com o `README.md` (como rodar) e, para regras de negócio e banco,
o `README.md`/`MANUAL.md`/`BALCAO.md` do projeto original na raiz do repositório.

## 1. Contexto

**AOOBA! BAR — Cardápio Digital**: o cliente escaneia o QR da mesa e pede pelo celular; o pedido cai em tempo real no
balcão; o dono edita o cardápio e vê relatórios. Backend: **Supabase** (Postgres + RLS + Auth + Realtime + RPCs).

- **Antes:** HTML + CSS + JS puro (módulos ES, sem build), na raiz do repositório (`index.html`, `js/`, `css/`...).
- **Agora:** **Vite + React 18 + TypeScript (strict)** na pasta `aooba-react/`.
- **O que NÃO mudou:** o banco (`supabase/*.sql` foi só copiado), o CSS (`src/styles/` é o CSS original), os textos,
  as regras de negócio e as chamadas de RPC.
- **O projeto original na raiz continua intacto** e é a referência de comportamento. Em caso de dúvida, compare com o
  arquivo antigo (tabela na seção 4).

Branch: `refactor-typescript-react`. Nada foi mergeado na `main`.

## 2. Como rodar

```bash
cd aooba-react
npm install
cp .env.example .env     # VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev              # http://localhost:5173
npm test                 # Vitest (79 testes)
npm run typecheck
npm run build            # tsc + vite build -> dist/
```

O `.env.example` aponta para o Supabase de **produção** (a chave publicável é pública por design; a `service_role`
nunca entra no front). **Use um projeto Supabase de sandbox para testar escritas** (criar pedido, fechar conta etc.):
troque as duas variáveis no seu `.env` local (que é ignorado pelo git).

## 3. Estado atual

### Pronto
- As 7 telas migradas, com a mesma lógica: cardápio do cliente, balcão, garçom, admin, mesas, relatórios, QR codes.
- Roteamento (React Router). Rotas novas sem `.html`; **as URLs antigas com `.html` continuam funcionando** — importante
  porque os QR codes já impressos apontam para `/index.html?mesa=N&t=TOKEN`.
- `netlify.toml` com fallback de SPA. Página 404 vira a rota `*` (`NaoEncontrado`).
- `tsc` (strict) e `vite build` passam. **79 testes passam.**

### NÃO validado (faça antes de publicar)
- **Nada foi rodado contra um Supabase real nem aberto no navegador.** Tudo foi validado só com `tsc`, build e testes
  com Supabase falso. Ler o código não substitui usar: passe por cada fluxo manualmente (seção 7).
- **Os tipos em `src/lib/types.ts` foram escritos à mão** a partir da leitura do JS antigo e do `schema_completo.sql`.
  O formato real do JSON das RPCs (`conta_da_mesa`, `conta_da_mesa_balcao`, `detalhe_pagamento`, `fechar_parcial`,
  `confirmar_pagamento`, `listar_mesas_balcao`, relatórios) pode diferir em algum campo sem que o compilador avise.
  Confira contra o SQL (`supabase/*.sql`) ou gere os tipos (`supabase gen types typescript`).
- Sem teste automatizado contra API/banco real, sem E2E (ver seção 6).

## 4. Mapa: arquivo antigo → arquivo novo

| Antigo | Novo |
|---|---|
| `js/supabaseClient.js`, `supabaseClientGarcom.js`, `supabaseConfig.js` | `src/lib/supabase.ts` (`supabase` e `supabaseGarcom`), env em `.env` |
| `js/shared.js` | `src/lib/shared.ts` (+ `components/Toast.tsx`, `components/Feedback.tsx`) |
| `js/auth.js` (`configurarLogin`) | `src/auth/RequireAuth.tsx` |
| `js/script.js` + `js/cardapio/*` | `src/pages/Cardapio.tsx` + `src/pages/cardapio/*` + `src/lib/carrinho.ts` + `src/lib/sessaoCliente.ts` |
| `js/cardapio/sessao.js` (máquina de estados) | `src/pages/cardapio/useSessao.ts` + `TravaModal.tsx` + decisões puras em `lib/sessaoCliente.ts` |
| `js/cardapio/carrinho.js` | `lib/carrinho.ts` (regras) + JSX do carrinho em `pages/Cardapio.tsx` |
| `js/cardapio/conta.js` | `src/pages/cardapio/ContaModal.tsx` |
| `js/cardapio/cliente.js` | `NomeModal.tsx` + helpers em `lib/sessaoCliente.ts` |
| `js/balcao.js` + `js/balcao/*` | `src/pages/Balcao.tsx` + `src/pages/balcao/*` |
| `balcao/realtime.js` | `balcao/useBalcaoRealtime.ts` + transições puras em `balcao/transicoes.ts` |
| `balcao/carregamento.js` | `balcao/carregamento.ts` |
| `balcao/conta.js` | `lib/contas.ts` + `components/ContaViews.tsx` |
| `balcao/fila.js`, `fechamentos.js`, `mesas-ativas.js`, `pagamentos.js` | dentro de `balcao/BalcaoConteudo.tsx` (+ `PagamentoCard.tsx`) |
| `balcao/historico.js` | `balcao/HistoricoModal.tsx` |
| `balcao/controle.js` + `js/controle-mesas.js` | `balcao/ControleMesasModal.tsx` + `hooks/useControleMesas.ts` |
| `balcao/senha.js` | `components/ConfirmarSenha.tsx` (hook `useConfirmarSenha`) |
| `balcao/som.js` | `hooks/useBeep.ts` |
| `js/garcom.js` + `js/garcom/*` | `src/pages/Garcom.tsx` + `src/pages/garcom/{NovoPedidoModal,ContaMesaModal}.tsx` |
| `js/admin.js` + `admin/config.js` | `src/pages/Admin.tsx` |
| `js/mesas.js` | `src/pages/Mesas.tsx` |
| `js/relatorios.js` | `src/pages/Relatorios.tsx` (react-chartjs-2) + `src/lib/backup.ts` |
| `js/gerar-qrcodes.js` | `src/pages/GerarQrCodes.tsx` (pacote `qrcode` via npm) |
| `404.html` | `src/pages/NaoEncontrado.tsx` |
| `css/*.css` | `src/styles/*.css` (idênticos) |
| `img/` | `public/img/` |
| CDNs (Chart.js, JSZip, qrcode, supabase-js via esm.sh) | dependências npm |

## 5. Decisões de arquitetura e por quê

1. **Vite SPA, não Next.js.** O site é estático no Netlify, sem SSR. Perde-se SEO dinâmico, mas o `index.html` já traz as
   tags Open Graph estáticas.
2. **Regras fora dos componentes, em funções puras testáveis.** Carrinho (`lib/carrinho.ts`), decisão da trava de sessão
   (`decidirSemSessao`/`decidirComSessao` em `lib/sessaoCliente.ts`), transições do Realtime (`balcao/transicoes.ts`),
   `tentarEncerrarSessao` (`lib/contas.ts`). Ao mexer em regra de negócio, mexa aí e cubra com teste.
3. **Sessão do cliente = máquina de telas** (`useSessao`): `carregando | acesso_bloqueado | boas_vindas | conta_encerrada |
   confirmar_entrada | entrada_cancelada | mesa_bloqueada | liberada`. O storage **nunca autoriza nada** — só decide qual
   tela mostrar; a defesa real é o `token_sessao` validado no servidor (`supabase/017_token_sessao.sql`).
   Invariantes que os testes protegem: o cardápio só carrega depois de `liberada`; sessão nova só sob toque explícito em
   "Iniciar pedido"; erro ao consultar a sessão **trava** em vez de liberar; mesa bloqueada vence "conta encerrada".
4. **Dois clientes Supabase.** `supabaseGarcom` usa `storageKey: 'sb-garcom-auth-token'` para o garçom ficar logado ao
   mesmo tempo que admin/balcão no mesmo navegador. Não unifique.
5. **`RequireAuth`** (render-prop) substitui `configurarLogin`. Com `papeis` só reage a **logout** no
   `onAuthStateChange` (para não rechecar o papel a cada refresh de token). `papeis={null}` = balcão (basta estar logado,
   como no original). O papel é conferido de novo no banco pelas RPCs/RLS — a checagem no front é só UX.
6. **Balcão: o "bump" de versão.** Os cards de conta (`FechamentoCard`, `MesaAtivaCard`) buscam os totais via
   `useContaAtiva(cliente, mesa, versao)`. Sempre que algo muda a conta (pedido, pagamento, remoção de item, carga
   inicial) chama-se `bump()` e os cards rebuscam. Substitui os `renderizarFechamentos()/renderizarMesasAtivas()` do
   original.
7. **Tabela `mesas` NÃO está no Realtime** de propósito (o token é secreto e o evento mandaria a linha inteira). Por isso
   balcão e garçom fazem **polling** (5 s) de `listar_mesas_balcao`, e a tela do cliente faz polling de
   `status_da_mesa` (8 s) quando a mesa está bloqueada. Não publique `mesas` no Realtime.
8. **CSS original reaproveitado**, sem CSS Modules. Cada página importa o seu (`import '../styles/balcao.css'`); depois de
   carregado o CSS fica global, como já era. O garçom importa `balcao.css` + `garcom.css`.
9. `window.alert`/`confirm` nativos foram **mantidos** como no original (há testes que dependem do comportamento de
   `tentarEncerrarSessao` com `Confirmador` injetável).

## 6. Testes

Rode `npm test` (Vitest + Testing Library + jsdom). Setup em `src/test/setup.ts` (stubs de `IntersectionObserver` e
`scrollIntoView`, que o jsdom não tem). `src/test/supabaseMock.ts` cria um cliente Supabase falso (`rpc`, `from` encadeável,
`channel`, `auth`) — nos testes de componente faça `vi.mock('.../lib/supabase', ...)` apontando para ele.

**Coberto:** carrinho, decisões e storage da sessão, `contas.ts`, transições do balcão, intervalo do histórico, total do
novo pedido, `RequireAuth` (papéis, login) e o Cardápio (acesso bloqueado, boas-vindas, mesa bloqueada, confirmar entrada,
conta encerrada, carrinho, `criar_pedido`, `SESSAO_ENCERRADA`).

**Falta cobrir (sugestão de ordem):**
1. **Testes de contrato contra um banco real** (sandbox ou Supabase local com Docker rodando
   `supabase/schema_completo.sql`): chamar as RPCs de verdade — abrir sessão, criar pedido, fechar parcial, confirmar
   pagamento, encerrar (com e sem saldo), bloquear/liberar mesa, rate limit — e o RLS (anônimo **não** lê `pedidos` nem o
   token de `mesas`). É o maior buraco hoje.
2. Testes de página: Admin, Mesas, Relatórios, Balcão e Garçom inteiros.
3. E2E (Playwright) contra o banco de teste: QR → pedido → aparece no balcão → fechar conta.
4. Gerar tipos com `supabase gen types` e trocar os de `lib/types.ts`.

## 7. Checklist de validação manual (antes de publicar)

Cliente (`/?mesa=N&t=TOKEN`, use o link de uma mesa de teste):
- [ ] Sem `t` na URL → "acesso bloqueado", nada pedível.
- [ ] Mesa livre → "Iniciar pedido" → pede o nome → cardápio aparece.
- [ ] Adicionar item, narguilé com "Dividir entre a mesa", essência (preço 0); fazer pedido; carrinho limpa.
- [ ] Segundo aparelho na mesma mesa → "Entrar na conta".
- [ ] Fechar conta: "Minha parte" (com/sem taxa) e "Fechar a conta toda"; saldo e status por pessoa.
- [ ] Balcão fecha a conta → o cliente vê "Conta encerrada"; F5 e reabrir a aba **não** liberam o cardápio.
- [ ] Mesa bloqueada → "aguardando liberação" e destrava sozinha ~8 s depois de liberar.
- [ ] Sem internet → faixa vermelha.

Balcão (`/balcao`): pedido novo chega em tempo real com beep (clicar em "Ativar som" antes); "Entregue"; remover item e
fechar mesa pedem senha; pagamento parcial → "Recebido" (encerra sozinho se quitou); histórico com filtro de data;
Controle de Mesas (liberar/desativar/ativar, "Liberar todas", "Bloquear todas" com segunda confirmação); indicador de
conexão.

Garçom (`/garcom`, celular): abas; "Novo pedido" só para papel `garcom`; "Ver conta"/"Fechar conta"; entrega de pedido;
logar como garçom e admin ao mesmo tempo em abas diferentes.

Admin: criar/editar/ordenar/ativar/excluir produto (excluir produto já pedido deve recusar e sugerir desativar);
taxa de serviço. Mesas: criar, ativar/desativar, copiar link, regerar token. Relatórios: atalhos, período custom, gráficos,
CSV, backup ZIP. QR codes: gerar e imprimir.

## 8. Diferenças conhecidas em relação ao original

- Rotas sem `.html` (as antigas seguem funcionando). `montarUrlMesa` agora gera `/?mesa=N&t=TOKEN`.
- Os headers das telas do dono (admin/mesas/relatórios/QR) agora mostram os 4 links de navegação; antes cada tela
  tinha um subconjunto.
- Modais do cliente (conta) são montados só quando abertos; o estado interno reinicia a cada abertura (o original mantinha
  o DOM e re-preenchia).
- Bibliotecas vêm do npm (versões fixadas no `package-lock.json`), não mais de CDN. O `supabase-js` é o da versão instalada
  pelo npm, não `2.110.8` do esm.sh — se houver diferença de comportamento em Auth/Realtime, comece por aí.
- Meta `robots: noindex` das telas restritas é inserida em runtime (o `index.html` é único e indexável).

## 9. Armadilhas

- **Git no Windows:** a pasta do repositório pertence a `BUILTIN/Administradores` e o Git recusa ("dubious ownership").
  Use `git -c safe.directory=<caminho> ...` ou `git config --global --add safe.directory <caminho>`.
- **Deploy no Netlify:** o projeto React está na subpasta `aooba-react/`. Configure base directory `aooba-react`,
  build `npm run build`, publish `dist`, e as duas variáveis `VITE_SUPABASE_*`. Se ficar na raiz, o Netlify continua
  servindo o site antigo.
- **Não altere** o banco/RLS/RPCs junto com a migração de front; qualquer mudança em `supabase/` exige regerar o
  `schema_completo.sql` (`supabase/ferramentas/gerar_schema_completo.mjs`, ver README original).
- **Nunca** coloque a `service_role` no front nem em variável `VITE_*` (tudo `VITE_*` vai para o navegador).
- Domínio: se trocar de `aooba.netlify.app`, atualize Open Graph/canonical em `index.html`.

## 10. Próximos passos sugeridos

1. Validar tipos de RPC (seção 3) e corrigir o que divergir.
2. Testes de contrato contra banco de sandbox (seção 6, item 1).
3. Passar o checklist manual (seção 7) e corrigir regressões.
4. Testes de página + E2E.
5. Abrir PR para a `main`, apontar o Netlify para `aooba-react/` e, só depois de validado em produção, remover o front
   antigo da raiz (e mover/atualizar `README.md`, `MANUAL.md`, `BALCAO.md`, `supabase/` e `.github/workflows/backup.yml`,
   que ainda vivem na raiz).
