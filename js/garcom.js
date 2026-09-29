// ========================================================================
// TELA DO GARÇOM — painel mobile-first pro celular do garçom no salão
// ========================================================================
//
// ETAPA 1: login + controle de acesso por papel + esqueleto das abas
// (Mesas/Pedidos).
// ETAPA 2: aba Mesas — lista com status, ações por mesa e em massa, tudo
// reaproveitando as MESMAS RPCs já usadas em balcao.js (nenhuma RPC nova
// foi criada nessa etapa).
// ETAPA 3: aba Pedidos — lista os pedidos pendentes (sessões abertas) com
// itens/horário/status e o botão "Marcar entregue", igual balcao.js só que
// enxuto pro celular (sem o botão de remover item — esse fica só no
// balcão). UPDATE direto em "pedidos" via RLS pedidos_update_authenticated,
// mesma RPC-menos-RPC que o balcão já usa.
// ETAPA 4: "Novo pedido" — o garçom lança pedido numa mesa SEM QR code,
// pra cliente sem celular. Precisou de uma RPC nova (lancar_pedido_garcom,
// ver supabase/024_lancar_pedido_garcom.sql), já que criar_pedido (o
// caminho do cliente) autoriza por TOKEN da mesa, e o garçom não tem —
// nem deve ter — acesso a esse token. A RPC nova autoriza por PAPEL em vez
// de token, e por pedido explícito só aceita papel 'garcom' (nem balcao
// nem admin) — ver _exigir_garcom() no SQL e papelUsuario/renderizarMesas
// aqui (o botão só aparece pra quem tem esse papel; a RPC recusa de
// qualquer forma se alguém tentar burlar via console).
// ETAPA 5 (esta): "Ver conta"/"Fechar conta" — reaproveita
// conta_da_mesa_balcao e encerrar_sessao, as MESMAS RPCs que "Mesas
// Ativas" em balcao.js já usa há muito tempo. Nenhuma RPC nova. Diferente
// de "Novo pedido", esta ação fica aberta pra garcom/balcao/admin — não é
// exclusiva de papel, porque fechar conta já era uma ação de qualquer
// authenticated no balcão antes deste arquivo existir.
//
// Login: sessão autenticada (Supabase Auth, igual balcao.html) — mas,
// diferente de balcao.html (que aceita QUALQUER conta autenticada), aqui
// TAMBÉM exige papel 'garcom', 'balcao' ou 'admin' em "perfis" (ver
// supabase/023_papel_garcom.sql). Login sem esse papel é barrado e
// deslogado — mesmo padrão de admin.js/relatorios.js pro papel admin.
//
// As RPCs que esta tela chama (ativar_mesa, desativar_mesa, liberar_mesa,
// liberar_todas_mesas, bloquear_todas_mesas, encerrar_sessao, e o UPDATE de
// status de entrega via RLS pedidos_update_authenticated) já são liberadas
// pra QUALQUER conta authenticated, sem checagem de papel — um garçom
// logado já consegue chamar todas elas, sem nenhuma RPC nova. A exceção é
// lancar_pedido_garcom, que exige especificamente o papel garcom (ver
// ETAPA 4 acima) — nenhuma outra ação desta tela tem essa restrição extra.
//
// REALTIME DA ABA MESAS — leia antes de mexer: "mesas" (a tabela) NÃO está
// publicada no Realtime, de propósito (o token é secreto — ver comentário
// no fim de supabase/019_bloqueio_mesa.sql; um evento Realtime manda a
// linha INTEIRA). Isso já valia pro balcão antes deste arquivo existir: se
// UM balcão/garçom chama liberar_mesa/ativar_mesa/desativar_mesa/
// liberar_todas_mesas/bloquear_todas_mesas, NENHUM outro aparelho é
// avisado na hora — só quando "sessoes" muda (fechamento total, que já
// está no Realtime desde 012_realtime_sessoes.sql) é que os outros
// aparelhos ficam sabendo, e mesmo assim só descobrem que a mesa foi
// BLOQUEADA (efeito colateral de _bloquear_mesa), nunca liberada/ativada/
// desativada por outro aparelho. Pra cobrir esse resto sem publicar
// "mesas" (o que vazaria token), esta aba faz um polling leve (ver
// INTERVALO_POLL_MESAS) enquanto a página está aberta — mesma ideia da
// tela do cliente fazendo polling de status_da_mesa (ver mostrarMesaBloqueada
// em js/cardapio/sessao.js), só que aqui é a lista inteira via listar_mesas_balcao.

// Cliente PRÓPRIO desta tela (não o de admin/balcão/mesas/relatórios) —
// ver js/supabaseClientGarcom.js pro porquê: sem isso, logar aqui e em
// balcao.html/admin.html ao mesmo tempo (mesmo navegador) faz um login
// derrubar o outro, porque os dois dividiriam a mesma sessão salva no
// localStorage.
import { supabase } from './supabaseClientGarcom.js';
import { configurarLogin } from './auth.js';
import { estado } from './garcom/estado.js';
import { controleMesas, mesasGrid, carregarMesasIniciais } from './garcom/mesas.js';
import { abrirNovoPedido } from './garcom/novo-pedido.js';
import { abrirContaMesa } from './garcom/conta.js';
import { carregarPedidosIniciais } from './garcom/pedidos.js';
import { inscreverRealtime, desinscreverRealtime, iniciarPollingMesas, pararPollingMesas } from './garcom/realtime.js';

// O código fica em js/garcom/: mesas.js (aba Mesas), novo-pedido.js (lançar
// pedido sem QR), conta.js (ver/fechar conta da mesa), pedidos.js (aba
// Pedidos), realtime.js (Realtime + polling) e estado.js (dados compartilhados).
// Aqui ficam só as abas, o clique nos cards de mesa e o bootstrap.

const abaMesas = document.getElementById('abaMesas');
const abaPedidos = document.getElementById('abaPedidos');
const tabMesasBtn = document.getElementById('tabMesasBtn');
const tabPedidosBtn = document.getElementById('tabPedidosBtn');

// ========================================================================
// ABAS (Mesas / Pedidos)
// ========================================================================
// Troca simples de visibilidade — sem router, sem estado na URL (a tela
// fica numa aba só do celular, recarregar sempre volta pra "Mesas").

const ABAS = {
  mesas: { secao: abaMesas, botao: tabMesasBtn },
  pedidos: { secao: abaPedidos, botao: tabPedidosBtn },
};

function mostrarAba(nome) {
  for (const [chave, { secao, botao }] of Object.entries(ABAS)) {
    const ativa = chave === nome;
    secao.hidden = !ativa;
    botao.classList.toggle('is-ativo', ativa);
    botao.setAttribute('aria-current', ativa ? 'page' : 'false');
  }
}

tabMesasBtn.addEventListener('click', () => mostrarAba('mesas'));
tabPedidosBtn.addEventListener('click', () => mostrarAba('pedidos'));

// Clique nos botões dos cards da aba Mesas (um listener só, delegado).
mesasGrid.addEventListener('click', (event) => {
  const botaoLiberar = event.target.closest('.controle-mesa-card__liberar');
  if (botaoLiberar) {
    controleMesas.liberar(botaoLiberar.dataset.mesa, botaoLiberar);
    return;
  }

  const botaoDesativar = event.target.closest('.controle-mesa-card__desativar');
  if (botaoDesativar) {
    controleMesas.desativar(botaoDesativar.dataset.mesa, botaoDesativar);
    return;
  }

  const botaoAtivar = event.target.closest('.controle-mesa-card__ativar');
  if (botaoAtivar) {
    controleMesas.ativar(botaoAtivar.dataset.mesa, botaoAtivar);
    return;
  }

  const botaoNovoPedido = event.target.closest('.controle-mesa-card__novo-pedido');
  if (botaoNovoPedido) {
    abrirNovoPedido(botaoNovoPedido.dataset.mesa, botaoNovoPedido);
    return;
  }

  const botaoVerConta = event.target.closest('.controle-mesa-card__ver-conta');
  if (botaoVerConta) {
    abrirContaMesa(botaoVerConta.dataset.mesa);
  }
});

// ========================================================================
// BOOTSTRAP — TEM que ser a ÚLTIMA coisa do arquivo (ver configurarLogin em
// auth.js: qualquer "let" declarado depois ainda estaria na zona morta
// temporal quando aoEntrar rodasse — já aconteceu aqui com
// mesasAtivas/canalRealtime)
// ========================================================================
//
// Papéis aceitos: garcom, balcao OU admin (os três podem operar o salão —
// ver eh_garcom_ou_balcao() em supabase/023_papel_garcom.sql).

await configurarLogin({
  cliente: supabase,
  conteudoEl: document.getElementById('garcomConteudo'),
  papeis: ['garcom', 'balcao', 'admin'],
  mensagemSemPermissao: 'Este usuário não tem permissão de garçom/balcão/admin.',
  aoEntrar: (papel) => {
    estado.papelUsuario = papel;
    carregarMesasIniciais();
    carregarPedidosIniciais();
    inscreverRealtime();
    iniciarPollingMesas();
  },
  aoSair: () => {
    estado.papelUsuario = null;
    pararPollingMesas();
    desinscreverRealtime();
  },
});

