# aooba-mobile — Cardápio do AOOBA! BAR em React Native (Expo)

Port do fluxo do cliente de `../aooba-react` para React Native, consumindo a `../aooba-api` (Express + Drizzle).
O cliente **lê o QR da mesa → entra na sessão → vê o cardápio → faz pedido → consulta/fecha a conta**.

## Rodar

```bash
npm install
cp .env.example .env     # EXPO_PUBLIC_API_URL: IP da máquina que roda a aooba-api
npm start                # abre o Expo; escaneie com o Expo Go (celular na mesma rede Wi-Fi)
npm test                 # Jest (83 testes, sem emulador)
npm run typecheck
```

Emulador Android usa `http://10.0.2.2:3333`. Sem câmera/emulador, cole o link da mesa no campo da tela inicial.
O QR aceita os já impressos (`https://.../index.html?mesa=5&t=TOKEN`) e `aooba://cardapio?mesa=5&t=TOKEN`.

## Arquitetura — MVVM

```
src/
  model/       dados e regras, sem React: tipos, carrinho, regrasSessao, qr, formatar,
               api (cliente HTTP da aooba-api), armazenamento (AsyncStorage atrás de interface)
  viewmodel/   estado + ações de cada tela, sem React Native: ViewModel (base com subscribe),
               SessaoViewModel (máquina de telas da mesa), CardapioViewModel, ContaViewModel
  view/        telas e componentes (só desenham o estado e chamam métodos do ViewModel)
  app/         rotas do Expo Router: `/` (scanner) e `/cardapio?mesa=N&t=TOKEN`
  composicao.ts  único lugar que escolhe as implementações reais (rede, armazenamento)
```

A View assina o ViewModel com `useSyncExternalStore` (`viewmodel/useViewModel.ts`). Como os ViewModels não conhecem
React Native, os testes rodam com Jest puro e uma API falsa.

## Regras preservadas do web (testadas)

- O cardápio só carrega depois de a sessão estar `liberada`.
- Sessão **nova** só com toque explícito em "Iniciar pedido".
- Na dúvida (rede fora, status não confirmado) a tela **trava** em vez de liberar.
- Mesa bloqueada vence "conta encerrada"; destrava sozinha por polling (8 s).
- O preço não vai no payload do pedido; essência entra com preço 0; só narguilé pode ser dividido.
- Carrinho é mantido se o pedido falhar.

## Fila de aprovação (novo)

Na **mesa bloqueada** o cliente digita o nome e toca "Pedir liberação"; o garçom vê "João — Mesa 5" na aba **Fila** do
`/garcom`, confirma que a pessoa está lá e aprova (ou recusa). O app acompanha por polling (8 s): aprovada → "Iniciar
pedido"; recusada → "Pedido não aprovado" e dá para pedir de novo. Aprovar libera a **mesa** (como o botão "Liberar mesa"),
então a defesa continua sendo o servidor. Exige a migração `../aooba-react/supabase/025_fila_aprovacao.sql`.

## Diferenças em relação ao web

- **Sem Realtime:** o web assinava `sessoes` no Supabase; aqui um polling de 10 s (`sessao_atual`) detecta a conta fechada.
  Erro de rede no polling não derruba a tela.
- **Ler o QR de novo é um começo explícito:** apaga a marca local de "conta encerrada" (o texto da tela manda escanear de
  novo para fazer novo pedido). Reabrir/retomar não apaga.
- Duas telas novas: `sem_conexao` (com "Tentar de novo") e `qr_invalido`. O web, ao falhar a consulta, caía em
  boas-vindas/conta encerrada.
- O `clienteId` agora persiste no aparelho (antes, por aba).

## Não validado

Só `tsc`, testes e o bundle Android (`expo export`). **Nunca rodado em celular/emulador nem contra a API com banco real.**
Passe pelo checklist de cliente da seção 7 do `../aooba-react/REFATORACAO.md` antes de apresentar.
Fora do escopo: balcão, garçom, admin, relatórios.
