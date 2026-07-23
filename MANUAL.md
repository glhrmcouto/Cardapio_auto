# Manual de uso — AOOBA! BAR

Guia rápido pra usar o sistema no dia a dia. Sem termos técnicos — se você
administra o bar ou atende no balcão, este manual é pra você.

Tem 4 telas diferentes. Cada uma serve pra uma coisa:

| Tela | Pra quê | Precisa de senha? |
|---|---|---|
| **Cardápio** | O cliente usa no celular dele pra pedir | Não |
| **Balcão** | A equipe usa pra ver os pedidos chegando | Sim |
| **Admin** | O dono usa pra mudar o cardápio e gerenciar as mesas | Sim |
| **Relatórios** | O dono usa pra ver as vendas | Sim |

---

## 1. Balcão — atender os pedidos

Essa é a tela que fica ligada o dia inteiro no computador do balcão.

### Ativar o som (fazer isso todo dia, ao abrir)

Assim que a tela abrir, clique em **"🔔 Ativar som"** no canto superior
direito. Sem isso, o sistema não vai tocar aquele bipe quando chegar pedido
novo — você teria que ficar de olho na tela o tempo todo, o que ninguém tem
tempo de fazer. O botão muda pra "🔊 Som ativado" quando funcionar.

### Quando chega um pedido

Um card aparece na tela sozinho (não precisa apertar nada pra atualizar),
com: número da mesa, os itens pedidos, e o total. Depois de levar o pedido
pra mesa, clique no botão **"Entregue"** do card — ele some da fila.

### Quando o cliente pede pra fechar a conta

Aparece um aviso destacado (com ⚠️) no topo da tela, mostrando a mesa e
tudo que foi consumido — com **subtotal**, **taxa de serviço (10%)** e o
**total a cobrar** já com a taxa somada. É esse último valor que se cobra
do cliente. Depois de cobrar e fechar com o cliente, clique em
**"Conta Fechada"**.

A mesma conta (subtotal + 10% + total) também aparece pro cliente quando
ele mesmo pede pra fechar a conta pelo celular — os dois lados sempre
mostram o mesmo valor.

⚠️ Se aparecer um aviso de "pedido ainda não entregue" junto com o
fechamento, confira antes de fechar — pode ter item que ainda não chegou na
mesa.

### Ver pedidos antigos

Botão **"Histórico"** no topo mostra todos os pedidos já feitos, com data e
horário. Dá pra filtrar por um dia específico clicando no campo de data.

### O indicador de conexão

No topo da tela tem uma bolinha colorida:
- 🟢 **Online** — tudo normal.
- 🟡 **Conectando** — espera alguns segundos.
- 🔴 **Sem conexão** — a internet caiu. Veja o que fazer nesse caso no
  [BALCAO.md](BALCAO.md), seção "Se a internet cair".

Se a tela mostrar "não foi possível carregar os pedidos" com um botão
**"Tentar novamente"**, é sinal de que algo falhou ao carregar — clique no
botão. Isso é diferente de "nenhum pedido pendente" (que significa
realmente que não tem pedido nenhum agora).

---

## 2. Admin — mudar o cardápio e gerenciar mesas

Acesse pelo link/atalho do painel administrativo e faça login.

### Editar um produto que já existe

Cada item do cardápio aparece num quadrado com nome, descrição, preço,
categoria e ordem. Mude o que quiser direto nos campos e clique em
**"Salvar"** no fim do quadrado. Uma mensagem verde confirma que salvou.

### Adicionar um produto novo

Clique em **"+ Adicionar produto"** no topo, preencha os campos e clique em
**"Criar produto"**.

### Tirar um produto do cardápio sem apagar o histórico

Clique em **"Desativar"** — o produto some do cardápio que o cliente vê,
mas continua existindo nos relatórios e nos pedidos antigos que já usaram
ele. Pra trazer de volta, clique em **"Ativar"** no mesmo lugar.

### Apagar um produto de vez

Clique em **"Excluir"**. Só funciona se esse produto **nunca** tiver sido
pedido por ninguém — se já foi, o sistema recusa e sugere desativar em vez
de excluir (é assim de propósito: apagar destruiria o histórico de vendas
de pedidos antigos).

### Mudar a ordem de exibição

As setas ▲ ▼ ao lado do número de ordem movem o item pra cima/baixo dentro
da mesma categoria.

### Gerenciar as mesas

Mais abaixo na mesma tela, seção **"Mesas"**:

- **"+ Adicionar mesa"** — cadastra uma mesa nova (só precisa do número).
- **"Ativar" / "Desativar"** — desliga uma mesa temporariamente (ex.: mesa
  quebrada). Enquanto desativada, o QR code dela para de funcionar.
- **"Regerar token"** — troca o link secreto daquela mesa. Use isso se um
  adesivo de QR code for roubado, fotografado por estranho, ou você
  desconfiar que vazou. O QR code impresso antigo para de funcionar na
  hora; será preciso imprimir um novo (veja a seção 4 abaixo).
- **"Copiar link"** — copia o endereço daquela mesa, caso precise mandar
  manualmente pra algum lugar.

---

## 3. Relatórios — acompanhar as vendas

Acesse pelo link/atalho de relatórios e faça login (mesma senha do admin).

### Escolher o período

No topo, botões rápidos: **Hoje**, **Últimos 7 dias**, **Últimos 30 dias**,
**Mês atual**. Ou escolha datas específicas nos campos "De"/"Até" e clique
em **"Aplicar"**.

### Os números principais

Quatro cartões no topo: faturamento total do período, número de pedidos,
ticket médio (quanto cada pedido costuma valer) e o item campeão de vendas.

### Os gráficos

- **Faturamento por dia** — mostra se as vendas estão subindo ou caindo ao
  longo do período escolhido.
- **Vendas por categoria** — o quanto cada tipo de produto (drinks,
  cervejas, narguilé...) representa do faturamento.
- **Movimento por hora** — mostra o horário de pico do bar, pra ajudar a
  decidir escala de equipe.

### A tabela de mais vendidos

Clique no nome de qualquer coluna (Produto, Qtd., Receita) pra ordenar por
ela — clique de novo pra inverter a ordem.

### Exportar dados

- **"Exportar CSV"** (na tabela de mais vendidos) — baixa só aquela tabela,
  do período escolhido, pra abrir numa planilha.
- **"Baixar backup completo"** (no topo da página) — baixa **todos** os
  produtos, pedidos e itens já registrados (não só do período escolhido),
  num arquivo `.zip` com os dados também em `.json`. Isso é uma cópia de
  segurança extra, além do backup automático que já roda sozinho todo dia
  (ver [README.md](README.md) → "Backup dos dados").

---

## 4. Gerar QR codes novos

Precisa disso quando: abrir o bar pela primeira vez, adicionar mesa nova,
ou regerar o token de alguma mesa (adesivo vazado/roubado).

1. Acesse o gerador de QR codes e faça login.
2. A página já mostra um QR code por mesa **ativa**, prontinho.
3. Acabou de adicionar/reativar uma mesa? Clique em **"Recarregar"**.
4. Clique em **"Imprimir"** — só os cards de QR code vão pro papel, sem o
   resto da página.
5. Recorte cada card pela linha tracejada e cole na mesa correspondente.

**Importante**: se você regerar o token de uma mesa no Admin, o QR code
impresso antigo dela **para de funcionar imediatamente**. Volte nesta
página, clique em "Recarregar" e reimprima só o card daquela mesa.

---

## Dúvidas comuns

**O cliente diz que pediu mas não chegou nada no balcão.**
Confira se o celular dele estava com internet no momento do pedido — a
página do cardápio mostra uma faixa vermelha "Sem internet — seu pedido não
será enviado" quando não tem conexão, então se o pedido "sumiu", o mais
provável é que nunca chegou a sair do celular dele.

**Um QR code parou de funcionar do nada.**
Verifique no Admin, seção Mesas, se aquela mesa está **ativa**. Se estiver
ativa e mesmo assim não funcionar, o token pode ter sido regenerado sem
reimprimir o QR novo — gere de novo em "Gerar QR codes".

**Esqueci a senha de login.**
Fale com quem administra o projeto Supabase (normalmente o dono/quem
configurou o sistema) — a senha é redefinida pelo painel do Supabase, em
Authentication → Users.
