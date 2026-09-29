# AOOBA! BAR — Cardápio Digital

Sistema de cardápio digital e atendimento pra um bar: o cliente pede pelo
celular (via QR code na mesa), o pedido cai em tempo real na tela do balcão,
e o dono acompanha vendas e edita o cardápio por painéis administrativos
separados.

Este README é técnico (deploy, banco de dados, estrutura de arquivos). Se
você é o dono do bar ou um garçom só querendo saber como usar o sistema no
dia a dia, veja o [MANUAL.md](MANUAL.md). Pra configurar o PC do balcão em
modo quiosque, veja o [BALCAO.md](BALCAO.md).

## Índice

- [O que tem aqui](#o-que-tem-aqui)
- [Stack](#stack)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Como rodar local](#como-rodar-local)
- [Como configurar o Supabase do zero](#como-configurar-o-supabase-do-zero)
- [Como publicar no Netlify](#como-publicar-no-netlify)
- [Onde ficam as credenciais](#onde-ficam-as-credenciais)
- [Backup dos dados](#backup-dos-dados)

## O que tem aqui

| Página | Pra quem | O que faz |
|---|---|---|
| `index.html` | Cliente (público, via QR code da mesa) | Cardápio, carrinho, envio de pedido e pedido de fechamento de conta |
| `balcao.html` | Garçom/balcão (login) | Fila de pedidos em tempo real, alertas de fechar conta, histórico |
| `admin.html` | Dono (login, papel admin) | Editar cardápio (produtos) e gerenciar mesas (ativar/desativar, token do QR code) |
| `relatorios.html` | Dono (login, papel admin) | Faturamento, produtos mais vendidos, ticket médio, horário de pico, backup de dados |
| `gerar-qrcodes.html` | Dono (login, papel admin) | Gera um QR code por mesa ativa, pronto pra imprimir e colar |
| `404.html` | — | Página de erro 404 personalizada (Netlify serve automaticamente) |

## Stack

- **Frontend**: HTML + CSS + JavaScript puro (sem framework, sem build —
  cada página é um arquivo `.html` carregando seu próprio `.js` como módulo
  ES). `shared.js` guarda funções pequenas repetidas entre as páginas
  (formatação de preço, escape de texto, data local).
- **Backend**: [Supabase](https://supabase.com) — Postgres (com Row Level
  Security), Auth (login de balcão/admin), Realtime (pedidos aparecendo na
  hora no balcão) e funções RPC (`supabase/*.sql`) pra qualquer escrita/leitura
  sensível.
- **Bibliotecas de terceiros** (via CDN, sem `npm install`): Chart.js
  (gráficos de `relatorios.html`), JSZip (backup em `.zip`), `qrcode`
  (geração de QR code).
- **Hospedagem**: [Netlify](https://netlify.com) (site estático, deploy
  automático a partir do repositório).
- **Backup**: GitHub Actions (`.github/workflows/backup.yml`), roda um
  `pg_dump` diário e guarda como artifact do workflow.

Não tem `package.json` de propósito — não tem nada pra instalar ou buildar.

## Estrutura do repositório

```
index.html                      → cardápio público
balcao.html                     → painel do balcão
admin.html                      → painel do dono (cardápio + mesas)
relatorios.html                 → painel do dono (vendas + backup manual)
gerar-qrcodes.html              → gerador de QR code das mesas
404.html                        → página de erro personalizada
js/
  script.js + cardapio/         → cardápio público (index.html): script.js só importa os módulos
  balcao.js + balcao/           → painel do balcão: balcao.js faz login/bootstrap, um módulo por painel
  admin.js + admin/             → painel do dono: produtos, mesas e configurações
  relatorios.js                 → lógica do painel de relatórios
  gerar-qrcodes.js               → lógica do gerador de QR code
  auth.js                       → login/logout das telas restritas (balcão, admin, relatórios, QR codes)
  shared.js                     → funções compartilhadas entre os .js acima
  supabaseClient.js             → cliente único do Supabase (URL + chave pública)
css/
  base.css                      → estilos compartilhados (variáveis de marca, header, botões, toast, modal, login)
  cardapio.css                  → estilos só do cardápio público (index.html)
  admin.css / balcao.css / relatorios.css / gerar-qrcodes.css
                                 → estilos específicos de cada painel
img/                            → logo e imagens usadas no site
supabase/
  001_schema.sql                → tabelas produtos/pedidos/pedido_itens + RPCs públicas (criar_pedido, pedir_fechamento, conta_da_mesa)
  002_realtime.sql               → habilita Realtime na tabela "pedidos"
  003_admin.sql                  → tabela "perfis" (papel admin/balcão) + RLS de escrita em produtos
  004_relatorios.sql             → RPCs de relatório (admin-only)
  005_seguranca.sql              → tabela "mesas" (token por QR code) + limites de abuso nos pedidos
  006_taxa_servico.sql           → taxa de serviço (10%) no fechamento de conta
  007_token_conta_mesa.sql       → exige o token da mesa também em conta_da_mesa
  008_sessoes.sql                → sessão de mesa, identificação do cliente e item compartilhado
  009_fechamento_parcial.sql     → "fechar minha parte" (pagamentos por pessoa)
  010_taxa_servico_configuravel.sql → taxa de serviço editável no admin (tabela configuracoes)
  011_correcoes_saldo_e_concorrencia.sql → correções de saldo e de concorrência no fechamento
  012_realtime_sessoes.sql       → Realtime na tabela "sessoes" (painel Mesas Ativas)
  013_agrupar_por_nome.sql       → agrupa a mesma pessoa por nome na conta
  014_sessao_vinculada.sql       → pedido/fechamento vinculados ao session_id do navegador
  015_encerramento_automatico.sql → encerra a sessão sozinha quando a conta é quitada
  016_rate_limit_por_pessoa.sql  → limite de pedidos por pessoa
  schema_completo.sql            → estado final de todas as migrações num arquivo só (instalação nova)
  ferramentas/gerar_schema_completo.mjs → gera e confere o schema_completo.sql
.github/workflows/backup.yml    → backup diário automático (pg_dump)
BALCAO.md                       → configurar o PC do balcão em modo quiosque
MANUAL.md                       → manual de uso pro dono/garçons, sem jargão técnico
```

## Como rodar local

Os arquivos são HTML/JS/CSS puros, mas os `.js` usam `<script type="module">`
(import/export) — isso **não funciona abrindo o arquivo direto no navegador**
(`file://...`), precisa de um servidor HTTP simples. Na raiz do projeto:

```bash
# Opção 1: Python (já vem em quase todo sistema)
python -m http.server 8000

# Opção 2: Node, sem instalar nada globalmente
npx serve -l 8000
```

Depois abra `http://localhost:8000/index.html` (ou `/balcao.html`,
`/admin.html` etc.). Como não tem build, qualquer alteração num arquivo já
aparece só recarregando a página.

Isso usa o Supabase de produção configurado em `supabaseClient.js` (ver
[Onde ficam as credenciais](#onde-ficam-as-credenciais)) — não tem "banco
local" separado. Para testar contra um projeto Supabase à parte (sandbox),
troque `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` nesse arquivo temporariamente.

## Como configurar o Supabase do zero

Se for montar o projeto do zero (novo bar, ou recuperando de um backup),
rode **um arquivo só** no **SQL Editor** do painel do Supabase
(`supabase.com/dashboard` → seu projeto → SQL Editor):

- **`supabase/schema_completo.sql`** — cria tudo de uma vez: tabelas, RLS,
  RPCs, Realtime, a configuração da taxa de serviço (10%), o cardápio de
  exemplo e as mesas 1 a 20 (cada uma com seu token). Antes de rodar, se
  for outro bar, ajuste no fim do arquivo os `INSERT INTO public.produtos`
  e o `generate_series(1, 20)` das mesas (ou deixe como está e edite tudo
  depois pelo admin.html).

Ele é o resultado de aplicar as migrações `001_...sql` a `016_...sql` em
ordem, gerado e conferido automaticamente — rodar as migrações uma a uma,
em ordem numérica, dá exatamente o mesmo banco. **Num banco que já está
em uso, nunca rode o `schema_completo.sql`**: aplique só as migrações novas.

**Criou uma migração nova?** Rode o gerador de novo e commite as duas coisas
juntas (precisa de Node 20+; não instala nada no projeto):

```bash
cd supabase/ferramentas
npm install --no-save @electric-sql/pglite @electric-sql/pglite-tools
node gerar_schema_completo.mjs
```

Depois de criar o banco, crie os usuários de login:

1. No painel do Supabase → **Authentication** → **Users** → **Add user** →
   crie um usuário pra quem vai logar no admin (e-mail + senha) e, se quiser
   um login separado só pro balcão, outro usuário.
2. No **SQL Editor**, rode o `insert into perfis (...)` do final de
   `003_admin.sql` pra cada usuário, trocando o e-mail e o papel
   (`'admin'` ou `'balcao'`) — sem essa linha o usuário loga mas o
   admin.html recusa mostrar qualquer coisa (login "sem permissão").
3. Atualize `supabaseClient.js` com a `SUPABASE_URL` e a
   `SUPABASE_PUBLISHABLE_KEY` do **novo** projeto (painel → Project Settings
   → API) — essas duas trocam a cada projeto Supabase novo.

## Como publicar no Netlify

1. No [app.netlify.com](https://app.netlify.com), **Add new site** → **Import
   an existing project** → conecta a conta do GitHub e escolhe este
   repositório.
2. Configuração de build: **não precisa de build command nem de publish
   directory diferente da raiz** — é um site estático puro. Deixe "Build
   command" em branco e "Publish directory" como `.` (raiz).
3. **Deploy site**. A cada push na branch principal, o Netlify republica
   sozinho.
4. A página 404 personalizada (`404.html`) é detectada automaticamente pelo
   Netlify — não precisa de nenhuma configuração extra (`_redirects` só
   seria necessário se este fosse um app de página única com rotas do lado
   do cliente, o que não é o caso aqui).
5. **Domínio**: o site está publicado em **https://aooba.netlify.app/**
   (subdomínio grátis do Netlify — HTTPS automático via Let's Encrypt). Se
   um dia trocar pra um domínio próprio, atualize as referências a esse
   endereço em `index.html` (tags Open Graph e `canonical`),
   `supabase/005_seguranca.sql` (os dois `SELECT` do fim do arquivo, só
   usados como referência manual) e `BALCAO.md`.

## Onde ficam as credenciais

| Credencial | Onde fica | Pode aparecer no repositório? |
|---|---|---|
| `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` | `supabaseClient.js` | **Sim** — é a chave pública (antiga "anon key"), feita pra rodar no navegador de qualquer visitante. Sozinha não dá acesso a nada; quem protege os dados é o RLS configurado nas migrações `supabase/*.sql`. |
| Senha do banco Postgres / connection string completa | Só no secret `SUPABASE_DB_URL` do GitHub (Settings → Secrets and variables → Actions) | **Nunca**. Usada só pelo workflow de backup. Passo a passo de onde pegar e como cadastrar: ver o topo de `.github/workflows/backup.yml`. |
| Login de admin/balcão (e-mail + senha) | Supabase Auth (painel → Authentication → Users) | Nunca — nem o hash de senha existe em lugar nenhum deste repositório. |
| `service_role` (chave secreta do Supabase) | Não é usada em lugar nenhum deste projeto | **Nunca deveria aparecer aqui** — se algum dia for necessária pra algum script administrativo, trate como a connection string: só em secret, nunca commitada. |

## Backup dos dados

Duas camadas, cobrindo cenários diferentes:

1. **Automático, diário**: `.github/workflows/backup.yml` roda `pg_dump`
   todo dia às 5h (Brasília) e guarda o resultado comprimido como artifact
   do GitHub Actions por 30 dias. Cobre "preciso restaurar o banco inteiro
   de X dias atrás".
2. **Manual, sob demanda**: botão "Baixar backup completo" em
   `relatorios.html` (admin) — baixa produtos/pedidos/itens em `.json` +
   `.csv` na hora, direto do navegador. Cobre "preciso de uma cópia dos
   dados agora, pra abrir numa planilha", sem precisar mexer no GitHub.
