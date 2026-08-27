// ========================================================================
// TELA DO GARÇOM — painel mobile-first pro celular do garçom no salão
// ========================================================================
//
// ETAPA 1: login + controle de acesso por papel + esqueleto das abas
// (Mesas/Pedidos).
// ETAPA 2: aba Mesas — lista com status, ações por mesa e em massa, tudo
// reaproveitando as MESMAS RPCs já usadas em balcao.js (nenhuma RPC nova
// foi criada nessa etapa).
// ETAPA 3 (esta): aba Pedidos — lista os pedidos pendentes (sessões
// abertas) com itens/horário/status e o botão "Marcar entregue", igual
// balcao.js só que enxuto pro celular (sem o botão de remover item —
// esse fica só no balcão). UPDATE direto em "pedidos" via RLS
// pedidos_update_authenticated, mesma RPC-menos-RPC que o balcão já usa.
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
// logado já consegue chamar todas elas hoje, sem nenhuma RPC nova. A
// exceção é criar_pedido (lançar pedido pelo garçom), hoje só concedida a
// "anon" com token de mesa — isso é tratado na Etapa 4, não aqui.
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
// em js/script.js), só que aqui é a lista inteira via listar_mesas_balcao.

import { supabase } from './supabaseClient.js';
import { formatarPreco, escaparTexto } from './shared.js';

const loginTela = document.getElementById('loginTela');
const loginForm = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginSenhaEl = document.getElementById('loginSenha');
const loginErroEl = document.getElementById('loginErro');
const loginEntrarBtn = document.getElementById('loginEntrarBtn');

const garcomConteudo = document.getElementById('garcomConteudo');
const sairBtn = document.getElementById('sairBtn');

const abaMesas = document.getElementById('abaMesas');
const abaPedidos = document.getElementById('abaPedidos');
const tabMesasBtn = document.getElementById('tabMesasBtn');
const tabPedidosBtn = document.getElementById('tabPedidosBtn');

const toastEl = document.getElementById('toast');

const mesasCarregandoEl = document.getElementById('mesasCarregando');
const mesasErroEl = document.getElementById('mesasErro');
const mesasTentarBtn = document.getElementById('mesasTentar');
const mesasVazioEl = document.getElementById('mesasVazio');
const mesasGrid = document.getElementById('mesasGrid');
const liberarTodasBtn = document.getElementById('liberarTodasBtn');
const bloquearTodasBtn = document.getElementById('bloquearTodasBtn');

const pedidosCarregandoEl = document.getElementById('pedidosCarregando');
const pedidosErroEl = document.getElementById('pedidosErro');
const pedidosTentarBtn = document.getElementById('pedidosTentar');
const pedidosVazioEl = document.getElementById('pedidosVazio');
const pedidosGrid = document.getElementById('pedidosGrid');
const pedidosBadgeEl = document.getElementById('pedidosBadge');

// ========================================================================
// LOGIN / LOGOUT (com checagem de papel garcom/balcao/admin)
// ========================================================================

function mostrarTelaLogin(mensagemErro) {
  garcomConteudo.style.display = 'none';
  loginTela.style.display = 'flex';
  loginEmailEl.value = '';
  loginSenhaEl.value = '';

  if (mensagemErro) {
    loginErroEl.textContent = mensagemErro;
    loginErroEl.style.display = 'block';
  } else {
    loginErroEl.style.display = 'none';
  }
}

let paginaIniciada = false;

function mostrarPagina() {
  loginTela.style.display = 'none';
  garcomConteudo.style.display = '';

  if (paginaIniciada) return;
  paginaIniciada = true;

  carregarMesasIniciais();
  carregarPedidosIniciais();
  inscreverRealtime();
  iniciarPollingMesas();
}

// Verifica se a sessão logada pertence a um usuário com papel garcom,
// balcao OU admin em "perfis" (os três podem operar o salão — ver
// eh_garcom_ou_balcao() em supabase/023_papel_garcom.sql). Diferente de
// admin.js, aqui a checagem é feita direto no client (SELECT simples,
// permitido pela policy perfis_select_proprio) em vez de via RPC — mais
// simples e é exatamente o mesmo padrão já usado em admin.js/relatorios.js
// pro papel admin.
const PAPEIS_PERMITIDOS = ['garcom', 'balcao', 'admin'];

async function verificarAcessoEExibir(session) {
  if (!session) {
    mostrarTelaLogin();
    return;
  }

  const { data: perfil, error } = await supabase
    .from('perfis')
    .select('papel')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Erro ao verificar permissão de acesso:', error);
    mostrarTelaLogin('Não foi possível verificar sua permissão agora. Tente de novo.');
    await supabase.auth.signOut();
    return;
  }

  if (!perfil || !PAPEIS_PERMITIDOS.includes(perfil.papel)) {
    mostrarTelaLogin('Este usuário não tem permissão de garçom/balcão/admin.');
    await supabase.auth.signOut();
    return;
  }

  mostrarPagina();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginEntrarBtn.disabled = true;
  loginEntrarBtn.textContent = 'Entrando...';
  loginErroEl.style.display = 'none';

  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmailEl.value.trim(),
    password: loginSenhaEl.value,
  });

  loginEntrarBtn.disabled = false;
  loginEntrarBtn.textContent = 'Entrar';

  if (error) {
    loginErroEl.textContent = 'E-mail ou senha inválidos.';
    loginErroEl.style.display = 'block';
    return;
  }

  await verificarAcessoEExibir(data.session);
});

sairBtn.addEventListener('click', () => {
  supabase.auth.signOut();
});

// Só reage a LOGOUT aqui — o login bem-sucedido já é tratado logo acima
// (via verificarAcessoEExibir), pra não checar o papel de novo a cada
// refresh automático de token.
supabase.auth.onAuthStateChange((_evento, session) => {
  if (!session) {
    paginaIniciada = false;
    pararPollingMesas();
    if (canalRealtime) {
      supabase.removeChannel(canalRealtime);
      canalRealtime = null;
    }
    mostrarTelaLogin();
  }
});

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

// ========================================================================
// TOAST (aviso discreto — mesmo padrão de js/balcao.js)
// ========================================================================

function mostrarToast(mensagem) {
  toastEl.textContent = mensagem;
  toastEl.classList.add('show');
  clearTimeout(mostrarToast._timer);
  mostrarToast._timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// ========================================================================
// ABA MESAS — lista, ações por mesa e em massa (reaproveita listar_mesas_balcao,
// liberar_mesa, ativar_mesa, desativar_mesa, liberar_todas_mesas e
// bloquear_todas_mesas, todas já existentes; ver comentário de REALTIME DA
// ABA MESAS no topo do arquivo pra como isso fica sincronizado com o balcão)
// ========================================================================

let mesasControle = []; // TODAS as mesas ({numero, status_mesa, ativa}) — ver listar_mesas_balcao
let mesasAtivas = [];   // sessões com status 'aberta' — uma por mesa ocupada agora

// Lista TODAS as mesas via RPC — nunca consulta a tabela "mesas" direto: RLS
// restringe o SELECT direto a admin (o token é secreto, ver 005_seguranca.sql)
// e garcom.html aceita garcom/balcao/admin. listar_mesas_balcao (ver
// supabase/019_bloqueio_mesa.sql) devolve só número/status_mesa/ativa,
// nunca o token.
async function carregarMesasControle() {
  const { data, error } = await supabase.rpc('listar_mesas_balcao');
  if (error) throw error;
  mesasControle = data;
}

// Toda mesa com sessão aberta agora (ver supabase/008_sessoes.sql) — usada
// só pro selo "Sessão aberta" no card; a decisão de pular mesa no bloqueio
// em massa é feita no banco (bloquear_todas_mesas), não aqui.
async function carregarMesasAtivas() {
  const { data, error } = await supabase
    .from('sessoes')
    .select('id, mesa')
    .eq('status', 'aberta');

  if (error) throw error;
  mesasAtivas = data;
}

async function carregarMesasIniciais() {
  mesasCarregandoEl.style.display = 'block';
  mesasErroEl.style.display = 'none';
  mesasGrid.innerHTML = '';

  try {
    await Promise.all([carregarMesasControle(), carregarMesasAtivas()]);
    renderizarMesas();
    mesasCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar mesas:', erro);
    mesasCarregandoEl.style.display = 'none';
    mesasErroEl.style.display = 'block';
  }
}

mesasTentarBtn.addEventListener('click', carregarMesasIniciais);

// Mesmo componente visual de .controle-mesa-card (balcao.css) — mesa
// inativa tem card simplificado (só "Ativar mesa"); mesa ativa mostra
// liberada/bloqueada, selo de sessão aberta e os botões cabíveis.
function renderizarMesas() {
  if (mesasControle.length === 0) {
    mesasVazioEl.style.display = 'block';
    mesasGrid.innerHTML = '';
    return;
  }

  mesasVazioEl.style.display = 'none';

  mesasGrid.innerHTML = mesasControle.map(mesa => {
    if (!mesa.ativa) {
      return `
      <div class="controle-mesa-card controle-mesa-card--inativa" data-mesa="${mesa.numero}">
        <div class="controle-mesa-card__mesa">Mesa ${mesa.numero}</div>
        <span class="controle-mesa-card__status controle-mesa-card__status--inativa">Inativa</span>
        <button type="button" class="btn btn--secondary controle-mesa-card__ativar" data-mesa="${mesa.numero}">Ativar mesa</button>
      </div>
    `;
    }

    const bloqueada = mesa.status_mesa === 'bloqueada';
    const temSessaoAberta = mesasAtivas.some(s => String(s.mesa) === String(mesa.numero));

    return `
    <div class="controle-mesa-card${bloqueada ? ' controle-mesa-card--bloqueada' : ''}" data-mesa="${mesa.numero}">
      <div class="controle-mesa-card__mesa">Mesa ${mesa.numero}</div>
      <span class="controle-mesa-card__status controle-mesa-card__status--${mesa.status_mesa}">${bloqueada ? 'Bloqueada' : 'Liberada'}</span>
      ${temSessaoAberta ? '<span class="controle-mesa-card__sessao">Sessão aberta</span>' : ''}
      ${bloqueada ? `<button type="button" class="btn btn--primary controle-mesa-card__liberar" data-mesa="${mesa.numero}">Liberar mesa</button>` : ''}
      <button type="button" class="btn btn--secondary controle-mesa-card__desativar" data-mesa="${mesa.numero}">Desativar mesa</button>
    </div>
  `;
  }).join('');
}

function atualizarMesaControleLocal(mesa, novoStatus) {
  const entrada = mesasControle.find(m => String(m.numero) === String(mesa));
  if (entrada) entrada.status_mesa = novoStatus;
  renderizarMesas();
}

async function liberarMesa(mesa, botao) {
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Liberando...';
  }

  const { error } = await supabase.rpc('liberar_mesa', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao liberar mesa:', error);
    alert('Não foi possível liberar a mesa agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Liberar mesa';
    }
    return;
  }

  atualizarMesaControleLocal(mesa, 'liberada');
}

async function desativarMesa(mesa, botao) {
  const confirmou = confirm(`Desativar a mesa ${mesa}? Ela some do cardápio pro cliente até alguém reativar.`);
  if (!confirmou) return;

  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Desativando...';
  }

  const { error } = await supabase.rpc('desativar_mesa', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao desativar mesa:', error);
    alert('Não foi possível desativar a mesa agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Desativar mesa';
    }
    return;
  }

  const entrada = mesasControle.find(m => String(m.numero) === String(mesa));
  if (entrada) entrada.ativa = false;
  renderizarMesas();
}

async function ativarMesa(mesa, botao) {
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Ativando...';
  }

  const { error } = await supabase.rpc('ativar_mesa', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao ativar mesa:', error);
    alert('Não foi possível ativar a mesa agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Ativar mesa';
    }
    return;
  }

  const entrada = mesasControle.find(m => String(m.numero) === String(mesa));
  if (entrada) entrada.ativa = true;
  renderizarMesas();
}

mesasGrid.addEventListener('click', (event) => {
  const botaoLiberar = event.target.closest('.controle-mesa-card__liberar');
  if (botaoLiberar) {
    liberarMesa(botaoLiberar.dataset.mesa, botaoLiberar);
    return;
  }

  const botaoDesativar = event.target.closest('.controle-mesa-card__desativar');
  if (botaoDesativar) {
    desativarMesa(botaoDesativar.dataset.mesa, botaoDesativar);
    return;
  }

  const botaoAtivar = event.target.closest('.controle-mesa-card__ativar');
  if (botaoAtivar) {
    ativarMesa(botaoAtivar.dataset.mesa, botaoAtivar);
  }
});

// ========================================================================
// AÇÕES EM MASSA — mesmas RPCs de supabase/022_mesas_em_massa.sql já
// usadas no balcão (liberar_todas_mesas, bloquear_todas_mesas)
// ========================================================================
//
// Recarrega listar_mesas_balcao inteira depois de qualquer uma das duas,
// em vez de tentar adivinhar localmente quem mudou — as duas RPCs mexem em
// várias linhas de uma vez.

async function liberarTodasMesas() {
  const confirmou = confirm('Liberar todas as mesas para pedido?');
  if (!confirmou) return;

  liberarTodasBtn.disabled = true;

  const { data: qtd, error } = await supabase.rpc('liberar_todas_mesas');

  liberarTodasBtn.disabled = false;

  if (error) {
    console.error('Erro ao liberar todas as mesas:', error);
    alert('Não foi possível liberar as mesas agora. Verifique sua conexão e tente de novo.');
    return;
  }

  try {
    await carregarMesasControle();
  } catch (erro) {
    console.error('Erro ao recarregar mesas depois de liberar todas:', erro);
  }
  renderizarMesas();
  mostrarToast(`${qtd} ${qtd === 1 ? 'mesa liberada' : 'mesas liberadas'}.`);
}

// Chama bloquear_todas_mesas primeiro sem forçar; se sobrar mesa pulada por
// ter conta aberta, avisa e só bloqueia essas também com uma SEGUNDA
// confirmação explícita (p_forcar=true) — nunca interrompe conta em
// andamento sem o operador saber exatamente o que está fazendo.
async function bloquearTodasMesas() {
  const confirmou = confirm('Bloquear todas as mesas?');
  if (!confirmou) return;

  bloquearTodasBtn.disabled = true;

  const { data: resultado, error } = await supabase.rpc('bloquear_todas_mesas', { p_forcar: false });

  if (error) {
    console.error('Erro ao bloquear todas as mesas:', error);
    bloquearTodasBtn.disabled = false;
    alert('Não foi possível bloquear as mesas agora. Verifique sua conexão e tente de novo.');
    return;
  }

  try {
    await carregarMesasControle();
  } catch (erro) {
    console.error('Erro ao recarregar mesas depois de bloquear todas:', erro);
  }
  renderizarMesas();

  const { bloqueadas, puladas } = resultado;

  if (puladas === 0) {
    bloquearTodasBtn.disabled = false;
    mostrarToast(`${bloqueadas} ${bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'}.`);
    return;
  }

  const forcar = confirm(
    `${bloqueadas} ${bloqueadas === 1 ? 'mesa foi bloqueada' : 'mesas foram bloqueadas'}. ` +
    `${puladas} ${puladas === 1 ? 'mesa tem' : 'mesas têm'} conta aberta e NÃO ${puladas === 1 ? 'foi bloqueada' : 'foram bloqueadas'}. ` +
    'Deseja bloquear essas também? (isso interrompe contas em andamento)'
  );

  if (!forcar) {
    bloquearTodasBtn.disabled = false;
    mostrarToast(`${bloqueadas} ${bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'} — ${puladas} com conta aberta não ${puladas === 1 ? 'foi mexida' : 'foram mexidas'}.`);
    return;
  }

  const { data: resultadoForcado, error: erroForcado } = await supabase.rpc('bloquear_todas_mesas', { p_forcar: true });

  bloquearTodasBtn.disabled = false;

  if (erroForcado) {
    console.error('Erro ao forçar bloqueio de todas as mesas:', erroForcado);
    alert('Não foi possível bloquear as mesas restantes agora. Verifique sua conexão e tente de novo.');
    return;
  }

  try {
    await carregarMesasControle();
  } catch (erro) {
    console.error('Erro ao recarregar mesas depois de forçar bloquear todas:', erro);
  }
  renderizarMesas();
  mostrarToast(`${resultadoForcado.bloqueadas} ${resultadoForcado.bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'} (incluindo com conta aberta).`);
}

liberarTodasBtn.addEventListener('click', liberarTodasMesas);
bloquearTodasBtn.addEventListener('click', bloquearTodasMesas);

// ========================================================================
// ABA PEDIDOS — fila de pedidos pendentes (reaproveita a MESMA consulta e
// o MESMO "marcar entregue" de js/balcao.js — nenhuma RPC nova; entregar é
// só um UPDATE em "pedidos" via RLS pedidos_update_authenticated). Sem o
// botão de remover item (fica só no balcão) — versão enxuta pro celular.
// ========================================================================

let pedidosGarcom = []; // pedidos tipo='pedido' status='pendente', cada um já com .itens embutido

function ordenarPedidosGarcom() {
  pedidosGarcom.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
}

// Mesmo embed do PostgREST usado em balcao.js: "itens:pedido_itens(...)"
// traz os itens do pedido numa consulta só, via FK pedido_itens.pedido_id.
async function carregarPedidosAtivos() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, total, status, criado_em, cliente_nome, itens:pedido_itens(id, nome:nome_snapshot, preco:preco_unitario, quantidade)')
    .eq('tipo', 'pedido')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  pedidosGarcom = data;
}

async function carregarPedidosIniciais() {
  pedidosCarregandoEl.style.display = 'block';
  pedidosErroEl.style.display = 'none';
  pedidosGrid.innerHTML = '';

  try {
    await carregarPedidosAtivos();
    renderizarPedidos();
    pedidosCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar pedidos:', erro);
    pedidosCarregandoEl.style.display = 'none';
    pedidosErroEl.style.display = 'block';
  }
}

pedidosTentarBtn.addEventListener('click', carregarPedidosIniciais);

function atualizarBadgePedidos() {
  const qtd = pedidosGarcom.length;
  pedidosBadgeEl.textContent = qtd;
  pedidosBadgeEl.hidden = qtd === 0;
}

// Mesmo componente visual .pedido-card de balcao.css — mesa, cliente,
// horário, status, itens e total; sem o botão de remover item.
function renderizarPedidos() {
  atualizarBadgePedidos();

  if (pedidosGarcom.length === 0) {
    pedidosVazioEl.style.display = 'block';
    pedidosGrid.innerHTML = '';
    return;
  }

  pedidosVazioEl.style.display = 'none';
  pedidosGrid.innerHTML = pedidosGarcom.map(pedido => `
    <div class="pedido-card" data-id="${pedido.id}">
      <div>
        <div class="pedido-card__mesa">Mesa ${pedido.mesa}</div>
        ${pedido.cliente_nome ? `<div class="pedido-card__cliente">${escaparTexto(pedido.cliente_nome)}</div>` : ''}
        <div class="pedido-card__horario">${formatarHorarioPedido(pedido.criado_em)}</div>
        <span class="pedido-card__status">Pendente</span>
      </div>
      <ul class="pedido-card__itens">
        ${pedido.itens.map(item => `
          <li>
            <span>${item.quantidade}x ${escaparTexto(item.nome)}</span>
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
      <div class="pedido-card__total">Total: ${formatarPreco(pedido.total)}</div>
      <button type="button" class="btn btn--primary pedido-card__entregar" data-id="${pedido.id}">Entregue</button>
    </div>
  `).join('');
}

// hh:mm local — mesma ideia de formatarHorario em js/balcao.js, sem
// precisar importar nada extra pra uma função dessas.
function formatarHorarioPedido(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Marca como entregue direto no Supabase (UPDATE simples, mesma RLS que o
// balcão usa) — só some da lista DEPOIS de confirmar, senão avisa que não
// deu certo e deixa como estava, pro garçom tentar de novo.
async function marcarEntregue(id, botao) {
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Marcando...';
  }

  const { error } = await supabase.from('pedidos').update({ status: 'entregue' }).eq('id', id);

  if (error) {
    console.error('Erro ao marcar pedido como entregue:', error);
    alert('Não foi possível marcar como entregue agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Entregue';
    }
    return;
  }

  pedidosGarcom = pedidosGarcom.filter(pedido => pedido.id !== id);
  renderizarPedidos();
}

pedidosGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pedido-card__entregar');
  if (!botao) return;
  marcarEntregue(botao.dataset.id, botao);
});

// ========================================================================
// REALTIME (sessoes + pedidos) + POLLING (mesas) — ver comentário de
// REALTIME DA ABA MESAS no topo do arquivo pro porquê "mesas" fica de fora
// daqui (só sessoes/pedidos, ambas já publicadas — 002_realtime.sql e
// 012_realtime_sessoes.sql — nenhuma mudança de banco precisou ser feita
// pra Etapa 3)
// ========================================================================

let canalRealtime = null;

// Uma sessão nova (mesa recém-ocupada) entra pro selo "Sessão aberta".
function lidarComInsercaoSessao(payload) {
  const novo = payload.new;
  if (novo.status !== 'aberta' || mesasAtivas.some(s => s.id === novo.id)) return;
  mesasAtivas.push(novo);
  renderizarMesas();
}

// Sessão fechada (encerrar_sessao, de QUALQUER aparelho/aba, garçom ou
// balcão) sempre bloqueia a mesa na mesma transação (_bloquear_mesa) — é
// esse evento que avisa este aparelho, na hora, que a mesa acabou de
// bloquear, sem precisar do polling.
function lidarComAtualizacaoSessao(payload) {
  const atualizado = payload.new;
  if (atualizado.status !== 'aberta' && mesasAtivas.some(s => s.id === atualizado.id)) {
    mesasAtivas = mesasAtivas.filter(s => s.id !== atualizado.id);
    renderizarMesas();
    atualizarMesaControleLocal(atualizado.mesa, 'bloqueada');
  }
}

// Pedido novo (de QUALQUER mesa, feito pelo cliente pelo celular dele)
// chega sem os itens embutidos (o evento Realtime só traz as colunas da
// própria linha de "pedidos") — busca os itens à parte antes de mostrar,
// mesmo padrão de lidarComInsercao em js/balcao.js.
async function lidarComInsercaoPedido(payload) {
  const novo = payload.new;
  if (novo.tipo !== 'pedido' || novo.status !== 'pendente') return;

  const { data: itens, error } = await supabase
    .from('pedido_itens')
    .select('id, nome:nome_snapshot, preco:preco_unitario, quantidade')
    .eq('pedido_id', novo.id);

  pedidosGarcom.push({ ...novo, itens: error ? [] : itens });
  ordenarPedidosGarcom();
  renderizarPedidos();
}

// Cobre o caso de outro aparelho (balcão ou outro garçom) ter marcado
// "Entregue"/fechado a conta antes deste: tira da lista local pra não
// ficar dessincronizado.
function lidarComAtualizacaoPedido(payload) {
  const atualizado = payload.new;
  if (atualizado.tipo === 'pedido' && atualizado.status !== 'pendente' && pedidosGarcom.some(p => p.id === atualizado.id)) {
    pedidosGarcom = pedidosGarcom.filter(p => p.id !== atualizado.id);
    renderizarPedidos();
  }
}

function inscreverRealtime() {
  canalRealtime = supabase
    .channel('garcom-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessoes' }, lidarComInsercaoSessao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes' }, lidarComAtualizacaoSessao)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, lidarComInsercaoPedido)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, lidarComAtualizacaoPedido)
    .subscribe();
}

// Cobre liberar_mesa/ativar_mesa/desativar_mesa/liberar_todas_mesas/
// bloquear_todas_mesas feitos em OUTRO aparelho — esses não passam por
// "sessoes", então não têm Realtime (ver comentário no topo do arquivo).
// 5s dá resposta quase instantânea pro garçom andando pelo salão, sem
// virar um polling pesado pro tamanho de um bar.
const INTERVALO_POLL_MESAS = 5000;
let pollIntervalId = null;

async function reconsultarMesas() {
  try {
    await Promise.all([carregarMesasControle(), carregarMesasAtivas()]);
    renderizarMesas();
  } catch (erro) {
    // Silencioso de propósito: um poll que falha não deve incomodar o
    // garçom com alert nenhum — o próximo poll (ou uma ação manual dele)
    // tenta de novo sozinho.
    console.error('Erro no polling de mesas:', erro);
  }
}

function iniciarPollingMesas() {
  pararPollingMesas();
  pollIntervalId = setInterval(reconsultarMesas, INTERVALO_POLL_MESAS);
}

function pararPollingMesas() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

// ========================================================================
// CHECAGEM INICIAL DE SESSÃO — TEM que ser a ÚLTIMA coisa do arquivo
// ========================================================================
//
// É um top-level await: a execução do módulo PAUSA aqui até resolver, e só
// então mostrarPagina()/carregarMesasIniciais() (chamados de dentro de
// verificarAcessoEExibir) rodam de verdade. Se isso ficasse no meio do
// arquivo (como ficou por engano numa versão anterior), qualquer "let"
// declarado DEPOIS dele ainda estaria na zona morta temporal quando essas
// funções tentassem usá-lo — ReferenceError "Cannot access 'x' before
// initialization" (foi exatamente o bug: mesasAtivas/canalRealtime
// declarados mais abaixo, acessados por uma chamada disparada por este
// await antes de o arquivo terminar de rodar até a declaração deles).
// Ficando por último, TUDO que a página inicial pode precisar já existe.
const { data: { session: sessaoInicial } } = await supabase.auth.getSession();
await verificarAcessoEExibir(sessaoInicial);
