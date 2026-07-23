# Configurar o PC do balcão (modo quiosque)

Guia pra deixar o computador do balcão sempre aberto direto na tela de pedidos
(`balcao.html`), sem barra de endereço, sem abas, sem ninguém precisar digitar
nada — liga o PC e a tela de pedidos já está lá.

Assume Windows (é o mais comum em PC de balcão) e o navegador Google Chrome.
Se o bar usa outro navegador (Edge, por exemplo), os passos são quase
idênticos — só troca `chrome.exe` por `msedge.exe`.

Em todo lugar abaixo que aparecer `https://SEU-DOMINIO-AQUI`, troca pelo
domínio real onde o site foi publicado (ver [README.md](README.md) → "Publicar
no Netlify").

---

## 1. Criar o atalho em modo quiosque

Modo quiosque (`--kiosk`) abre o Chrome em tela cheia, sem barra de endereço,
sem abas, sem botão de fechar visível — só a página, ocupando a tela toda.

1. Clique com o botão direito na Área de Trabalho → **Novo** → **Atalho**.
2. No campo de local, cole (numa linha só, com aspas):

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing --incognito "https://SEU-DOMINIO-AQUI/balcao.html"
   ```

   - `--kiosk` → tela cheia, sem chrome de navegador.
   - `--kiosk-printing` → se um dia o bar imprimir algo direto do navegador, pula a caixa de diálogo de impressão.
   - `--incognito` → evita que fique cache/sessão de outra pessoa que já usou esse Chrome nesse PC; a sessão de login do balcão persiste normalmente enquanto a janela ficar aberta (é assim que o app já funciona hoje).

   Se o Chrome estiver instalado em outro lugar, o caminho pode ser diferente
   — no Windows 10/11 de 64 bits o mais comum é o caminho acima; em instalação
   de 32 bits costuma ser `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`.

3. Nome do atalho: algo como `AOOBA Balcão`.
4. Clique com o botão direito no atalho criado → **Propriedades** → aba
   **Atalho** → **Executar**: escolha **Maximizada** (garante tela cheia mesmo
   nos primeiros segundos, antes do `--kiosk` assumir).

Teste dando duplo clique no atalho: deve abrir direto na tela de login do
balcão, ocupando a tela inteira.

**Pra sair do modo quiosque** (manutenção, trocar de conta, etc.): `Alt + F4`
fecha a janela. Se travar, `Ctrl + Alt + Del` → Gerenciador de Tarefas →
finalizar `chrome.exe`.

---

## 2. Iniciar automaticamente junto com o Windows

Assim, se a energia cair e voltar (ou alguém reiniciar o PC sem querer), a
tela de pedidos volta sozinha, sem precisar de ninguém pra clicar em nada.

1. Pressione `Win + R`, digite `shell:startup` e Enter — abre a pasta de
   inicialização do Windows (é por usuário; se o PC tem uma conta fixa "balcão",
   faça login nela antes desse passo).
2. Copie o atalho criado no passo 1 (Ctrl+C) e cole dentro dessa pasta
   (Ctrl+V) — **copie o atalho, não recorte**, pra manter o original na
   Área de Trabalho também, caso precise.
3. Reinicie o PC pra testar: o Chrome deve abrir sozinho, já em modo
   quiosque, na tela de pedidos.

**Login automático do Windows (opcional, mas recomendado):** se o PC tem uma
conta dedicada só pro balcão, vale configurar o Windows pra logar nela
sozinho ao ligar (sem pedir senha), pra "iniciar com o Windows" realmente
significar "liga e já está pronto". Em `netplwiz` (Win+R → digite `netplwiz`)
dá pra desmarcar "Os usuários devem digitar um nome de usuário e uma senha".

---

## 3. Desativar suspensão de tela / hibernação

Se a tela apagar ou o PC dormir no meio do expediente, o garçom perde a
visão da fila até acordar o PC — e some o beep de novo pedido enquanto isso
(o som só funciona com a página ativa).

1. **Configurações do Windows** → **Sistema** → **Energia e bateria** (ou
   "Energia e suspensão", dependendo da versão do Windows).
2. Em **Tela**: "Nunca" pra desligar a tela.
3. Em **Suspensão**: "Nunca".
4. Se o PC tiver um plano de energia dedicado (Painel de Controle → Opções
   de Energia), edite o plano ativo e repita os mesmos ajustes lá — em
   algumas versões do Windows os dois lugares controlam coisas ligeiramente
   diferentes.

Isso deixa a tela sempre acesa; se isso preocupar (desgaste de tela, consumo),
uma alternativa é usar um protetor de tela "em branco" com tempo bem longo
(ex.: 2h) em vez de "nunca" — mas evite suspensão/hibernação, que de fato
desliga a tela e pode até derrubar a conexão de rede.

---

## 4. Se a internet cair

O balcão inteiro depende de internet (os pedidos vêm da nuvem, não tem nada
gravado só no PC). O indicador no canto superior direito da tela do balcão
já avisa o estado da conexão:

- 🟢 **Online** — tudo funcionando normal.
- 🟡 **Conectando... / Reconectando...** — instabilidade momentânea, geralmente
  se resolve sozinho em alguns segundos.
- 🔴 **Sem conexão** — sem internet de verdade.

Se ficar 🔴 por mais que um minuto ou dois:

1. **Confirme que não é só o PC** — outro aparelho (celular, por exemplo)
   também está sem internet? Se sim, é o link do bar que caiu, não o PC.
2. **Reinicie o roteador/modem** (desliga da tomada, espera uns 10 segundos,
   liga de novo) — resolve a maioria dos casos.
3. **Enquanto isso, avise a equipe pra atender por fora do sistema**: os
   pedidos continuam sendo feitos verbalmente/anotados no papel até a conexão
   voltar — o cardápio publicado (`index.html`) também vai avisar o cliente
   com a faixa vermelha "Sem internet — seu pedido não será enviado" se ele
   tentar pedir pelo celular nesse meio tempo, então ele não vai achar que o
   pedido foi enviado quando não foi.
4. **Se o bar tiver um roteador 4G/hotspot de backup**, esse é o momento de
   ligar nele — o Chrome muda de rede sozinho, só recarregue a página
   (`F5`) depois de conectar.
5. **Quando a conexão voltar**, recarregue a página do balcão (`F5`) pra
   garantir que ele reconecta e busca o que ficou pendente enquanto esteve
   fora do ar. Pedidos feitos pelo cliente enquanto a internet do BAR estava
   fora do ar simplesmente não chegam a existir (o cardápio recusa enviar
   sem conexão) — não tem "fila escondida" pra recuperar depois.

---

## 5. Checklist rápido de setup (resumo)

- [ ] Atalho criado com `--kiosk` apontando pra `balcao.html`
- [ ] Atalho testado manualmente (abre em tela cheia, direto no login)
- [ ] Cópia do atalho na pasta `shell:startup`
- [ ] PC reiniciado pra confirmar que abre sozinho
- [ ] Login automático do Windows configurado (se o PC for dedicado ao balcão)
- [ ] Suspensão de tela e do PC desativadas
- [ ] Equipe sabe onde fica o indicador de conexão e o que fazer se ficar 🔴
- [ ] Login do balcão feito uma vez (a sessão persiste sozinha depois disso)
- [ ] Som ativado (botão "🔔 Ativar som" no header) — sem isso os beeps de pedido novo não tocam
