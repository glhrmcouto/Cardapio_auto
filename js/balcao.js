// ========================================
// TELA DO BALCÃO — recebe os pedidos do cardápio em tempo real via Supabase
// ========================================
//
// Nada aparece sem login (supabase.auth.signInWithPassword). A sessão persiste
// sozinha entre recarregamentos (comportamento padrão do supabase-js, guardada
// no localStorage do navegador). Depois de logado, carrega os pedidos/fechamentos
// pendentes uma vez e assina Realtime (INSERT/UPDATE em "pedidos") pra tudo o
// mais chegar sozinho, sem precisar recarregar a página — inclusive de outro
// aparelho (celular do cliente fazendo pedido enquanto o balcão fica no PC).

import { supabase } from './supabaseClient.js';
import { formatarPreco, escaparTexto } from './shared.js';

// ========================================
// ELEMENTOS
// ========================================

const loginTela = document.getElementById('loginTela');
const loginForm = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginSenhaEl = document.getElementById('loginSenha');
const loginErroEl = document.getElementById('loginErro');
const loginEntrarBtn = document.getElementById('loginEntrarBtn');

const balcaoConteudo = document.getElementById('balcaoConteudo');
const sairBtn = document.getElementById('sairBtn');
const conexaoStatusEl = document.getElementById('conexaoStatus');

const balcaoErroEl = document.getElementById('balcaoErro');
const balcaoTentarBtn = document.getElementById('balcaoTentar');
const balcaoGrid = document.getElementById('balcaoGrid');
const balcaoVazio = document.getElementById('balcaoVazio');
const contadorPedidos = document.getElementById('contadorPedidos');
const fechamentoGrid = document.getElementById('fechamentoGrid');
const pagamentoGrid = document.getElementById('pagamentoGrid');
const mesasAtivasGrid = document.getElementById('mesasAtivasGrid');
const mesasAtivasVazio = document.getElementById('mesasAtivasVazio');
const controleMesasGrid = document.getElementById('controleMesasGrid');
const controleMesasVazio = document.getElementById('controleMesasVazio');

const controleMesasBtn = document.getElementById('controleMesasBtn');
const controleMesasOverlay = document.getElementById('controleMesasOverlay');
const controleMesasModal = document.getElementById('controleMesasModal');
const controleMesasClose = document.getElementById('controleMesasClose');
const liberarTodasBtn = document.getElementById('liberarTodasBtn');
const bloquearTodasBtn = document.getElementById('bloquearTodasBtn');

const historicoBtn = document.getElementById('historicoBtn');
const historicoOverlay = document.getElementById('historicoOverlay');
const historicoModal = document.getElementById('historicoModal');
const historicoLista = document.getElementById('historicoLista');
const historicoVazio = document.getElementById('historicoVazio');
const historicoClose = document.getElementById('historicoClose');
const historicoFiltroData = document.getElementById('historicoFiltroData');
const historicoFiltroLimpar = document.getElementById('historicoFiltroLimpar');

const toastEl = document.getElementById('toast');

const confirmarSenhaOverlay = document.getElementById('confirmarSenhaOverlay');
const confirmarSenhaModal = document.getElementById('confirmarSenhaModal');
const confirmarSenhaInput = document.getElementById('confirmarSenhaInput');
const confirmarSenhaAviso = document.getElementById('confirmarSenhaAviso');
const confirmarSenhaCancelar = document.getElementById('confirmarSenhaCancelar');
const confirmarSenhaOk = document.getElementById('confirmarSenhaOk');

// Aviso discreto no rodapé (mesmo padrão de js/script.js) — usado hoje só
// pro encerramento automático de sessão (ver confirmarRecebimentoPagamento
// e supabase/015_encerramento_automatico.sql).
function mostrarToast(mensagem) {
  toastEl.textContent = mensagem;
  toastEl.classList.add('show');
  clearTimeout(mostrarToast._timer);
  mostrarToast._timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

const STATUS_LABEL_PESSOA = { em_aberto: 'Em aberto', aguardando: 'Aguardando', pago: 'Pago' };

let pedidos = []; // só os pedidos com status "pendente" — cada um já vem com .itens embutido
let fechamentos = []; // pedidos de "fechar conta" (mesa inteira) ainda não atendidos
let pagamentosPendentes = []; // pagamentos parciais ("fechar minha parte") ainda não confirmados
let mesasAtivas = []; // sessões com status "aberta" — uma por mesa ocupada agora
let mesasControle = []; // TODAS as mesas ({numero, status_mesa, ativa}) — ver listar_mesas_balcao

// Precisam estar declaradas AQUI (antes do "await" inicial de sessão lá
// embaixo) e não perto do resto do código de polling — senão
// iniciarPollingMesas() (chamado de dentro de mostrarTelaLogada, disparado
// por esse await) tenta usá-las antes de a própria declaração "let"/"const"
// rodar (zona morta temporal) e quebra silenciosamente, sem nenhum erro
// visível na tela — foi exatamente esse bug. Ver mesmo cuidado em
// js/garcom.js (lá a solução foi mover o await pro fim do arquivo).
const INTERVALO_POLL_MESAS = 5000;
let pollMesasIntervalId = null;

function formatarHorario(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ========================================
// LOGIN / LOGOUT
// ========================================

function mostrarTelaLogin(mensagemErro) {
  balcaoConteudo.style.display = 'none';
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

// Carrega os dados iniciais e assina o Realtime só na primeira vez que loga
// (evita assinar duas vezes se onAuthStateChange disparar de novo, ex.: refresh de token)
let balcaoIniciado = false;

async function mostrarTelaLogada() {
  loginTela.style.display = 'none';
  balcaoConteudo.style.display = '';

  if (balcaoIniciado) return;
  balcaoIniciado = true;

  await carregarTudoInicial();
  inscreverRealtime();
  iniciarPollingMesas();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginEntrarBtn.disabled = true;
  loginEntrarBtn.textContent = 'Entrando...';
  loginErroEl.style.display = 'none';

  const { error } = await supabase.auth.signInWithPassword({
    email: loginEmailEl.value.trim(),
    password: loginSenhaEl.value,
  });

  loginEntrarBtn.disabled = false;
  loginEntrarBtn.textContent = 'Entrar';

  if (error) {
    loginErroEl.textContent = 'E-mail ou senha inválidos.';
    loginErroEl.style.display = 'block';
  }
  // Se dar certo, onAuthStateChange (abaixo) cuida de trocar de tela.
});

sairBtn.addEventListener('click', () => {
  supabase.auth.signOut();
});

// Reage a login/logout — inclusive logout feito em outra aba, já que o supabase-js
// propaga a mudança de sessão entre abas do mesmo navegador.
supabase.auth.onAuthStateChange((_evento, session) => {
  if (session) {
    mostrarTelaLogada();
  } else {
    desinscreverRealtime();
    pararPollingMesas();
    balcaoIniciado = false;
    pedidos = [];
    fechamentos = [];
    pagamentosPendentes = [];
    mesasAtivas = [];
    renderizarPedidos();
    fechamentoGrid.innerHTML = '';
    pagamentoGrid.innerHTML = '';
    mesasAtivasGrid.innerHTML = '';
    mostrarTelaLogin();
  }
});

// Checagem inicial explícita (a sessão persiste sozinha entre recarregamentos)
const { data: { session: sessaoInicial } } = await supabase.auth.getSession();
if (sessaoInicial) {
  mostrarTelaLogada();
} else {
  mostrarTelaLogin();
}

// ========================================
// CONFIRMAÇÃO DE SENHA (ações sensíveis: remover item, fechar mesa)
// ========================================
//
// Reautentica com signInWithPassword usando o e-mail JÁ logado (supabase.auth.getUser) —
// isso não troca de conta nem cria sessão nova de verdade, só confirma que quem está
// com a mão no balcão agora sabe a senha antes de uma ação difícil de desfazer
// (remover item de pedido, fechar mesa direto). Qualquer erro (senha errada, sem
// conexão) recusa e mantém o modal aberto pra tentar de novo.

let acaoPendenteSenha = null;

function pedirConfirmacaoSenha(acao) {
  acaoPendenteSenha = acao;
  confirmarSenhaInput.value = '';
  confirmarSenhaAviso.classList.remove('show');
  confirmarSenhaOverlay.classList.add('is-open');
  confirmarSenhaModal.classList.add('is-open');
  confirmarSenhaInput.focus();
}

function fecharConfirmacaoSenha() {
  acaoPendenteSenha = null;
  confirmarSenhaOverlay.classList.remove('is-open');
  confirmarSenhaModal.classList.remove('is-open');
}

async function confirmarSenha() {
  const senha = confirmarSenhaInput.value;
  const acao = acaoPendenteSenha;

  if (!senha || !acao) return;

  confirmarSenhaOk.disabled = true;
  confirmarSenhaOk.textContent = 'Confirmando...';
  confirmarSenhaAviso.classList.remove('show');

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.auth.signInWithPassword({ email: user?.email, password: senha });

  confirmarSenhaOk.disabled = false;
  confirmarSenhaOk.textContent = 'Confirmar';

  if (error) {
    confirmarSenhaAviso.classList.add('show');
    confirmarSenhaInput.focus();
    confirmarSenhaInput.select();
    return;
  }

  fecharConfirmacaoSenha();
  await acao();
}

confirmarSenhaCancelar.addEventListener('click', fecharConfirmacaoSenha);
confirmarSenhaOverlay.addEventListener('click', fecharConfirmacaoSenha);
confirmarSenhaOk.addEventListener('click', confirmarSenha);
confirmarSenhaInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmarSenha();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && confirmarSenhaModal.classList.contains('is-open')) {
    fecharConfirmacaoSenha();
  }
});

// ========================================
// INDICADOR DE CONEXÃO
// ========================================

let estadoRede = navigator.onLine ? 'online' : 'offline';
let estadoCanal = 'conectando';

function recalcularIndicadorConexao() {
  let estado = 'reconectando';
  if (estadoRede === 'offline') estado = 'offline';
  else if (estadoCanal === 'SUBSCRIBED') estado = 'online';
  else if (estadoCanal === 'conectando') estado = 'conectando';

  const textos = {
    online: '🟢 Online',
    conectando: '🟡 Conectando...',
    reconectando: '🟡 Reconectando...',
    offline: '🔴 Sem conexão',
  };
  conexaoStatusEl.textContent = textos[estado];
}

window.addEventListener('online', () => { estadoRede = 'online'; recalcularIndicadorConexao(); });
window.addEventListener('offline', () => { estadoRede = 'offline'; recalcularIndicadorConexao(); });

// ========================================
// SOM (beep de pedido novo / fechamento)
// ========================================

const ativarSomBtn = document.getElementById('ativarSomBtn');
const somAvisoEl = document.getElementById('somAviso');

// Um único AudioContext reaproveitado em todos os beeps — criar um novo a cada chamada
// esgota o limite de contextos simultâneos do navegador e o áudio acaba morrendo.
let audioCtx = null;
let somAtivo = false; // true depois que o garçom ativa; volta a false se ele clicar de novo pra desativar

function obterAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Toca um único tom (Web Audio API, sem precisar de arquivo de áudio)
function tocarTom(ctx, frequencia, atraso, duracao) {
  const inicio = ctx.currentTime + atraso;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequencia;
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao);
}

// Mostra um aviso discreto no header pedindo pra ativar o som
function mostrarAvisoSom() {
  if (somAvisoEl) somAvisoEl.classList.add('show');
}

// Reflete o estado atual (ativo/desativado) no texto e no aria-pressed do botão
function atualizarBotaoSom() {
  if (!ativarSomBtn) return;
  ativarSomBtn.textContent = somAtivo ? '🔊 Som ativado' : '🔔 Ativar som';
  ativarSomBtn.setAttribute('aria-pressed', String(somAtivo));
}

// Toca o beep de "pedido novo" (agudo, único) ou de "fechar conta" (mais grave e duplo).
// Só toca se o garçom tiver ativado o som; senão mostra o aviso pra ele clicar em "Ativar som".
function tocarBeep(tipo = 'pedido') {
  if (!somAtivo) {
    mostrarAvisoSom();
    return;
  }

  const ctx = obterAudioContext();

  if (tipo === 'fechamento') {
    tocarTom(ctx, 440, 0, 0.16);
    tocarTom(ctx, 440, 0.22, 0.16);
  } else {
    tocarTom(ctx, 880, 0, 0.18);
  }
}

// Ao clicar: se o som estava desativado, destrava o AudioContext e confirma com um beep de teste;
// se já estava ativo, apenas desativa (sem precisar suspender o contexto)
if (ativarSomBtn) {
  ativarSomBtn.addEventListener('click', () => {
    if (somAtivo) {
      somAtivo = false;
      atualizarBotaoSom();
      return;
    }

    const ctx = obterAudioContext();
    ctx.resume().then(() => {
      somAtivo = true;
      tocarTom(ctx, 880, 0, 0.18);
      atualizarBotaoSom();
      if (somAvisoEl) somAvisoEl.classList.remove('show');
    });
  });
}

// ========================================
// CARREGAMENTO INICIAL (Supabase)
// ========================================
//
// "itens:pedido_itens(nome:nome_snapshot, preco:preco_unitario, quantidade)" usa o
// embed automático do PostgREST pela FK pedido_itens.pedido_id -> pedidos.id, já
// apelidando as colunas pra "nome"/"preco" — assim o resto do arquivo (os templates
// de card) fica idêntico ao que já era antes, só trocando de onde os dados vêm.

// Lançam o erro em vez de engolir (pedidos = []) de propósito: um balcão que
// mostra "nenhum pedido pendente" porque a consulta falhou é pior que não
// mostrar nada — o garçom lê aquilo como "salão vazio" e pode deixar cliente
// esperando. Quem decide o que fazer com a falha é carregarTudoInicial.
async function carregarPedidosPendentes() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, total, status, criado_em, cliente_nome, itens:pedido_itens(id, nome:nome_snapshot, preco:preco_unitario, quantidade)')
    .eq('tipo', 'pedido')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  pedidos = data;
}

async function carregarFechamentosPendentes() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, criado_em')
    .eq('tipo', 'fechar_conta')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  fechamentos = data;
}

// "sessoes(mesa)" usa o embed do PostgREST pela FK pagamentos.sessao_id ->
// sessoes.id — pagamentos não guarda o número da mesa direto (só sessao_id),
// então é assim que a gente descobre de qual mesa é cada pagamento pendente.
async function carregarPagamentosPendentes() {
  const { data, error } = await supabase
    .from('pagamentos')
    .select('id, sessao_id, cliente_id, nome, subtotal, taxa_servico, valor_total, taxa_aceita, status, criado_em, sessoes(mesa)')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  pagamentosPendentes = data.map(p => ({ ...p, mesa: p.sessoes ? p.sessoes.mesa : null }));
}

// Toda mesa com sessão aberta agora, ocupada ou não (ver supabase/008_sessoes.sql)
// — é essa lista que vira o painel "Mesas Ativas", pra mostrar o consumo de
// cada mesa mesmo antes de alguém pedir pra fechar a conta.
async function carregarMesasAtivas() {
  const { data, error } = await supabase
    .from('sessoes')
    .select('id, mesa, aberta_em')
    .eq('status', 'aberta')
    .order('mesa');

  if (error) throw error;
  mesasAtivas = data;
}

// Lista TODAS as mesas (não só as com sessão aberta) via RPC — nunca
// consulta a tabela "mesas" direto: RLS restringe o SELECT direto a admin
// de propósito (o token é secreto, ver 005_seguranca.sql), e balcao.html
// aceita qualquer conta autenticada, não só admin. A RPC listar_mesas_balcao
// (ver supabase/019_bloqueio_mesa.sql) devolve só número/status_mesa/ativa,
// nunca o token.
async function carregarMesasControle() {
  const { data, error } = await supabase.rpc('listar_mesas_balcao');
  if (error) throw error;
  mesasControle = data;
}

async function carregarTudoInicial() {
  balcaoErroEl.style.display = 'none';

  try {
    await Promise.all([
      carregarPedidosPendentes(),
      carregarFechamentosPendentes(),
      carregarPagamentosPendentes(),
      carregarMesasAtivas(),
      carregarMesasControle(),
    ]);
  } catch (erro) {
    console.error('Erro ao carregar pedidos/fechamentos:', erro);
    balcaoGrid.innerHTML = '';
    fechamentoGrid.innerHTML = '';
    pagamentoGrid.innerHTML = '';
    mesasAtivasGrid.innerHTML = '';
    controleMesasGrid.innerHTML = '';
    balcaoVazio.style.display = 'none';
    balcaoErroEl.style.display = 'block';
    return;
  }

  renderizarPedidos();
  await renderizarPagamentosPendentes();
  await renderizarFechamentos();
  await renderizarMesasAtivas();
  renderizarControleMesas();
}

balcaoTentarBtn.addEventListener('click', carregarTudoInicial);

function ordenarPedidos() {
  pedidos.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
}

// Itens + totais (geral/pago/aguardando confirmação/saldo restante) + resumo
// por pessoa da SESSÃO ABERTA da mesa (rateio dos compartilhados e status de
// pagamento já aplicados no banco). Usa a RPC conta_da_mesa_balcao (ver
// supabase/009_fechamento_parcial.sql) em vez de consultar a tabela direto,
// porque essa lógica é melhor mantida num só lugar (o banco), não duplicada
// aqui e na RPC do cliente (conta_da_mesa).
async function obterContaAtivaDaMesa(mesa) {
  const { data, error } = await supabase.rpc('conta_da_mesa_balcao', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao consultar itens da mesa:', error);
    return { itens: [], subtotal: 0, taxaServico: 0, totalGeral: 0, totalPago: 0, totalPendente: 0, saldoRestante: 0, porPessoa: [] };
  }

  return {
    itens: data.itens,
    subtotal: data.subtotal,
    taxaServico: data.taxa_servico,
    totalGeral: data.total_geral,
    totalPago: data.total_pago,
    totalPendente: data.total_pendente_confirmacao,
    saldoRestante: data.saldo_restante,
    porPessoa: data.por_pessoa,
  };
}

// ========================================
// FILA DE PEDIDOS
// ========================================

function renderizarPedidos() {
  contadorPedidos.textContent = pedidos.length;

  if (pedidos.length === 0) {
    balcaoVazio.style.display = 'block';
    balcaoGrid.innerHTML = '';
    return;
  }

  balcaoVazio.style.display = 'none';
  balcaoGrid.innerHTML = pedidos.map(pedido => `
    <div class="pedido-card" data-id="${pedido.id}">
      <div>
        <div class="pedido-card__mesa">Mesa ${pedido.mesa}</div>
        ${pedido.cliente_nome ? `<div class="pedido-card__cliente">${escaparTexto(pedido.cliente_nome)}</div>` : ''}
        <div class="pedido-card__horario">${formatarHorario(pedido.criado_em)}</div>
      </div>
      <ul class="pedido-card__itens">
        ${pedido.itens.map(item => `
          <li>
            <span>${item.quantidade}x ${item.nome}</span>
            <span class="pedido-card__item-fim">
              ${formatarPreco(item.preco * item.quantidade)}
              <button type="button" class="pedido-card__item-remover" data-pedido-id="${pedido.id}" data-item-id="${item.id}" aria-label="Remover ${escaparTexto(item.nome)}" title="Remover item (pedido errado)">✕</button>
            </span>
          </li>
        `).join('')}
      </ul>
      <div class="pedido-card__total">Total: ${formatarPreco(pedido.total)}</div>
      <button class="btn btn--primary pedido-card__entregar" data-id="${pedido.id}">Entregue</button>
    </div>
  `).join('');
}

// Remove um item de um pedido ainda pendente (ver remover_item_pedido em
// supabase/018_remover_item_pedido.sql) — "pediu errado". Se era o último
// item, o pedido inteiro some da fila (o banco já apaga a linha).
async function removerItemPedido(pedidoId, itemId, botao) {
  if (botao) botao.disabled = true;

  const { error } = await supabase.rpc('remover_item_pedido', {
    p_pedido_id: pedidoId,
    p_item_id: Number(itemId),
  });

  if (error) {
    console.error('Erro ao remover item do pedido:', error);
    alert(error.message || 'Não foi possível remover o item agora. Verifique sua conexão e tente de novo.');
    if (botao) botao.disabled = false;
    return;
  }

  const pedido = pedidos.find(p => p.id === pedidoId);
  if (pedido) {
    pedido.itens = pedido.itens.filter(item => String(item.id) !== String(itemId));
    if (pedido.itens.length === 0) {
      pedidos = pedidos.filter(p => p.id !== pedidoId);
    } else {
      pedido.total = pedido.itens.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
    }
  }

  renderizarPedidos();
  await renderizarMesasAtivas();
}

// Marca como entregue direto no Supabase; some da fila só depois de confirmar,
// senão avisa que não deu certo (fica como estava, garçom tenta de novo)
async function marcarComoEntregue(id) {
  const botao = balcaoGrid.querySelector(`.pedido-card__entregar[data-id="${id}"]`);
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

  pedidos = pedidos.filter(pedido => pedido.id !== id);
  renderizarPedidos();
}

balcaoGrid.addEventListener('click', (event) => {
  const botaoEntregar = event.target.closest('.pedido-card__entregar');
  if (botaoEntregar) {
    marcarComoEntregue(botaoEntregar.dataset.id);
    return;
  }

  const botaoRemover = event.target.closest('.pedido-card__item-remover');
  if (botaoRemover) {
    const { pedidoId, itemId } = botaoRemover.dataset;
    pedirConfirmacaoSenha(() => removerItemPedido(pedidoId, itemId, botaoRemover));
  }
});

// ========================================
// FECHAMENTO DE CONTA
// ========================================

// Desenha os alertas de "fechar conta" pendentes, com o total já calculado
async function renderizarFechamentos() {
  const cards = await Promise.all(fechamentos.map(async fechamento => {
    const conta = await obterContaAtivaDaMesa(fechamento.mesa);
    const pendentes = pedidos.filter(pedido => String(pedido.mesa) === String(fechamento.mesa)).length;

    return `
    <div class="fechamento-card" data-id="${fechamento.id}">
      <span class="fechamento-card__icon">⚠️</span>
      <div class="fechamento-card__mesa">MESA ${fechamento.mesa} — FECHAR CONTA</div>
      <div class="fechamento-card__horario">${formatarHorario(fechamento.criado_em)}</div>
      ${pendentes > 0 ? `<div class="fechamento-card__aviso-pendente">⚠️ Esta mesa tem ${pendentes} pedido(s) ainda não entregue(s)</div>` : ''}
      <ul class="pedido-card__itens">
        ${conta.itens.map(item => `
          <li>
            <span>${item.quantidade}x ${item.nome}</span>
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
      <div class="fechamento-card__saldo">
        <span>Total <strong>${formatarPreco(conta.totalGeral)}</strong> <span class="fechamento-card__saldo-servico">(serviço ${formatarPreco(conta.taxaServico)})</span></span>
        <span>Pago <strong>${formatarPreco(conta.totalPago)}</strong></span>
        <span class="falta">Falta <strong>${formatarPreco(conta.saldoRestante)}</strong></span>
      </div>
      ${conta.porPessoa.length > 1 ? `
        <div class="fechamento-card__pessoas">
          <div class="fechamento-card__pessoas-titulo">Por pessoa</div>
          ${conta.porPessoa.map(pessoa => `
            <div class="fechamento-card__linha">
              <span>${escaparTexto(pessoa.nome)}<span class="fechamento-card__pessoa-status fechamento-card__pessoa-status--${pessoa.status}">${STATUS_LABEL_PESSOA[pessoa.status] || pessoa.status}</span></span>
              <span>${formatarPreco(pessoa.valor)}</span>
            </div>
            <div class="fechamento-card__pessoa-detalhe">Subtotal ${formatarPreco(pessoa.subtotal)} + Serviço ${formatarPreco(pessoa.taxa_servico)}</div>
          `).join('')}
        </div>
      ` : ''}
      <div class="fechamento-card__total">A cobrar (saldo restante): ${formatarPreco(conta.saldoRestante)}</div>
      <button class="btn btn--primary fechamento-card__fechar" data-id="${fechamento.id}">Conta Fechada</button>
    </div>
  `;
  }));

  fechamentoGrid.innerHTML = cards.join('');
}

// Tenta encerrar a sessão sem forçar; se a RPC recusar por sobrar saldo (ver
// supabase/009_fechamento_parcial.sql), avisa quanto falta e de quem e pergunta
// se fecha mesmo assim — só então chama de novo com p_forcar=true. Qualquer
// outro erro (ex.: sessão já não existe mais) só é avisado, sem oferecer forçar.
async function tentarEncerrarSessao(mesa) {
  const { error } = await supabase.rpc('encerrar_sessao', { p_mesa: mesa, p_forcar: false });

  if (!error) return true;

  if (error.details === 'CONTA_JA_ENCERRADA') {
    // Não é erro de verdade: a sessão provavelmente já foi fechada sozinha
    // pelo encerramento automático (ver supabase/015_encerramento_automatico.sql)
    // enquanto esse card ainda estava na tela — avisa sem alarde e segue o
    // fluxo normal (finalizarFechamento limpa a UI local do mesmo jeito).
    alert(error.message);
    return true;
  }

  if (error.message && error.message.startsWith('Ainda falta receber')) {
    const confirmou = confirm(`${error.message}\n\nFechar a conta mesmo assim?`);
    if (!confirmou) return false;

    const { error: erroForcado } = await supabase.rpc('encerrar_sessao', { p_mesa: mesa, p_forcar: true });
    if (erroForcado) {
      console.error('Erro ao forçar fechamento da sessão:', erroForcado);
      alert('Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
      return false;
    }
    return true;
  }

  console.error('Erro ao finalizar fechamento:', error);
  alert(error.message || 'Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
  return false;
}

// Remove o alerta da tela e chama a RPC encerrar_sessao (ver supabase/009_fechamento_parcial.sql),
// que marca a sessão da mesa como fechada e todos os pedidos dela (consumo +
// fechar_conta) como finalizado — substitui os dois updates manuais que este
// arquivo fazia antes de existir sessão.
async function finalizarFechamento(id) {
  const fechamento = fechamentos.find(f => f.id === id);
  if (!fechamento) return;

  const pendentes = pedidos.filter(pedido => String(pedido.mesa) === String(fechamento.mesa)).length;
  if (pendentes > 0) {
    const confirmou = confirm(
      `Mesa ${fechamento.mesa} tem ${pendentes} pedido(s) ainda não entregue(s). Fechar a conta mesmo assim?`
    );
    if (!confirmou) return;
  }

  const botao = fechamentoGrid.querySelector(`.fechamento-card__fechar[data-id="${id}"]`);
  if (botao) botao.disabled = true;

  const sucesso = await tentarEncerrarSessao(fechamento.mesa);

  if (!sucesso) {
    if (botao) botao.disabled = false;
    return;
  }

  fechamentos = fechamentos.filter(f => f.id !== id);
  pedidos = pedidos.filter(pedido => String(pedido.mesa) !== String(fechamento.mesa));
  // Tira a mesa de "Mesas Ativas" na hora, sem esperar o Realtime da tabela
  // "sessoes" ir e voltar (que também cobre esse mesmo caso, pra quando o
  // fechamento é feito por OUTRO aparelho/aba).
  mesasAtivas = mesasAtivas.filter(s => String(s.mesa) !== String(fechamento.mesa));
  renderizarPedidos();
  await renderizarFechamentos();
  await renderizarMesasAtivas();
  // encerrar_sessao (dentro de tentarEncerrarSessao) já bloqueou a mesa
  // sozinha no banco — ver supabase/019_bloqueio_mesa.sql.
  atualizarMesaControleLocal(fechamento.mesa, 'bloqueada');
}

fechamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.fechamento-card__fechar');
  if (!botao) return;
  finalizarFechamento(botao.dataset.id);
});

// ========================================
// PAGAMENTO PARCIAL ("fechar minha parte")
// ========================================
//
// Diferente do fechamento da mesa inteira: não mexe em pedidos nem na sessão,
// só cobra a parte já congelada daquela pessoa (ver fechar_parcial em
// supabase/009_fechamento_parcial.sql). Cada card busca o detalhe (itens
// diretos + fatias de compartilhados) via detalhe_pagamento antes de
// desenhar, igual ao padrão já usado em renderizarFechamentos.

async function renderizarPagamentosPendentes() {
  const cards = await Promise.all(pagamentosPendentes.map(async pagamento => {
    const { data: detalhe, error } = await supabase.rpc('detalhe_pagamento', { p_pagamento_id: pagamento.id });
    const itensDiretos = error || !detalhe ? [] : detalhe.itens_diretos;
    const itensCompartilhados = error || !detalhe ? [] : detalhe.itens_compartilhados;

    return `
    <div class="pagamento-card" data-id="${pagamento.id}">
      <div class="pagamento-card__titulo">MESA ${pagamento.mesa} — <strong>${escaparTexto(pagamento.nome)}</strong> quer fechar: ${formatarPreco(pagamento.valor_total)}</div>
      <div class="pagamento-card__horario">${formatarHorario(pagamento.criado_em)}</div>
      ${!pagamento.taxa_aceita ? '<div class="pagamento-card__sem-taxa">⚠️ Recusou a taxa de serviço</div>' : ''}
      <ul class="pagamento-card__itens">
        ${itensDiretos.map(item => `
          <li><span>${item.quantidade}x ${item.nome}</span><span>${formatarPreco(item.preco * item.quantidade)}</span></li>
        `).join('')}
        ${itensCompartilhados.map(item => `
          <li><span>${item.nome} (fração compartilhada)</span><span>${formatarPreco(item.valor)}</span></li>
        `).join('')}
      </ul>
      <div class="pagamento-card__resumo">
        <div class="pagamento-card__linha"><span>Subtotal</span><span>${formatarPreco(pagamento.subtotal)}</span></div>
        <div class="pagamento-card__linha"><span>Serviço</span><span>${formatarPreco(pagamento.taxa_servico)}</span></div>
        <div class="pagamento-card__linha pagamento-card__linha--total"><span>Total</span><span>${formatarPreco(pagamento.valor_total)}</span></div>
      </div>
      <button class="btn btn--primary pagamento-card__ok" data-id="${pagamento.id}">Recebido</button>
    </div>
  `;
  }));

  pagamentoGrid.innerHTML = cards.join('');
}

// Confirma o recebimento via RPC (confirmar_pagamento) em vez de update direto
// na tabela — assim confirmado_em e a validação de "só se ainda tava pendente"
// ficam garantidos no banco, não dependem do front-end estar correto.
async function confirmarRecebimentoPagamento(id) {
  const botao = pagamentoGrid.querySelector(`.pagamento-card__ok[data-id="${id}"]`);
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Marcando...';
  }

  const { data, error } = await supabase.rpc('confirmar_pagamento', { p_pagamento_id: id });

  if (error) {
    console.error('Erro ao confirmar pagamento:', error);
    alert('Não foi possível marcar como recebido agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Recebido';
    }
    return;
  }

  pagamentosPendentes = pagamentosPendentes.filter(p => p.id !== id);

  // Essa pode ter sido a última pendência da sessão — o banco já encerrou
  // ela sozinho na mesma transação (ver supabase/015_encerramento_automatico.sql).
  // Mesmo raciocínio de finalizarFechamento (fechamento manual): limpa o
  // estado local da mesa na hora, sem esperar o Realtime ir e voltar, pra
  // não desenhar por um instante um card de mesa/pedido que já foi encerrado.
  if (data && data.sessao_encerrada) {
    pedidos = pedidos.filter(pedido => String(pedido.mesa) !== String(data.mesa));
    fechamentos = fechamentos.filter(f => String(f.mesa) !== String(data.mesa));
    mesasAtivas = mesasAtivas.filter(s => String(s.mesa) !== String(data.mesa));
    renderizarPedidos();
    mostrarToast(`Mesa ${data.mesa} quitada e encerrada automaticamente.`);
    // confirmar_pagamento já bloqueou a mesa sozinha no banco quando
    // encerrou a sessão (ver supabase/019_bloqueio_mesa.sql).
    atualizarMesaControleLocal(data.mesa, 'bloqueada');
  }

  await renderizarPagamentosPendentes();
  // O card de "Conta Fechada" da mesa e o de "Mesas Ativas" mostram Total/
  // Pago/Falta calculado em cima dos pagamentos — sem isso, ficavam com o
  // valor antigo (como se nada tivesse sido pago) até algo mais disparar um
  // re-render.
  await renderizarFechamentos();
  await renderizarMesasAtivas();
}

pagamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pagamento-card__ok');
  if (!botao) return;
  confirmarRecebimentoPagamento(botao.dataset.id);
});

// ========================================
// MESAS ATIVAS (visão geral, mesa por mesa)
// ========================================
//
// Uma mesa entra nessa lista assim que a sessão dela abre (primeiro pedido —
// ver criar_pedido em supabase/008_sessoes.sql) e sai quando a sessão fecha
// (encerrar_sessao). Reaproveita obterContaAtivaDaMesa (mesma RPC
// conta_da_mesa_balcao do card de fechamento) pra montar itens + subtotal/
// serviço/total/saldo de cada mesa, mesmo antes de alguém pedir pra fechar.

async function renderizarMesasAtivas() {
  if (mesasAtivas.length === 0) {
    mesasAtivasVazio.style.display = 'block';
    mesasAtivasGrid.innerHTML = '';
    return;
  }

  mesasAtivasVazio.style.display = 'none';

  const cards = await Promise.all(mesasAtivas.map(async sessao => {
    const conta = await obterContaAtivaDaMesa(sessao.mesa);

    return `
    <div class="mesa-ativa-card" data-mesa="${sessao.mesa}">
      <div class="mesa-ativa-card__mesa">Mesa ${sessao.mesa}</div>
      <div class="mesa-ativa-card__horario">Aberta às ${formatarHorario(sessao.aberta_em)}</div>
      ${conta.itens.length === 0
        ? '<p class="mesa-ativa-card__vazio">Nenhum pedido registrado ainda.</p>'
        : `<ul class="pedido-card__itens">
            ${conta.itens.map(item => `
              <li>
                <span>${item.quantidade}x ${item.nome}</span>
                <span>${formatarPreco(item.preco * item.quantidade)}</span>
              </li>
            `).join('')}
          </ul>`
      }
      <div class="fechamento-card__saldo">
        <span>Total <strong>${formatarPreco(conta.totalGeral)}</strong> <span class="fechamento-card__saldo-servico">(serviço ${formatarPreco(conta.taxaServico)})</span></span>
        <span>Pago <strong>${formatarPreco(conta.totalPago)}</strong></span>
        <span class="falta">Falta <strong>${formatarPreco(conta.saldoRestante)}</strong></span>
      </div>
      ${conta.porPessoa.length > 1 ? `
        <div class="fechamento-card__pessoas">
          <div class="fechamento-card__pessoas-titulo">Por pessoa</div>
          ${conta.porPessoa.map(pessoa => `
            <div class="fechamento-card__linha">
              <span>${escaparTexto(pessoa.nome)}<span class="fechamento-card__pessoa-status fechamento-card__pessoa-status--${pessoa.status}">${STATUS_LABEL_PESSOA[pessoa.status] || pessoa.status}</span></span>
              <span>${formatarPreco(pessoa.valor)}</span>
            </div>
            <div class="fechamento-card__pessoa-detalhe">Subtotal ${formatarPreco(pessoa.subtotal)} + Serviço ${formatarPreco(pessoa.taxa_servico)}</div>
          `).join('')}
        </div>
      ` : ''}
      <button type="button" class="btn btn--secondary mesa-ativa-card__fechar" data-mesa="${sessao.mesa}">Fechar mesa</button>
    </div>
  `;
  }));

  mesasAtivasGrid.innerHTML = cards.join('');
}

// Fecha a mesa direto (sem esperar o cliente pedir "Fechar a conta" pelo
// cardápio) — ex.: cliente foi embora sem pedir fechamento. Reaproveita
// tentarEncerrarSessao (mesmo aviso de saldo pendente/confirmação de forçar
// que o fluxo de responder um pedido de fechamento já usa).
async function fecharMesaDireto(mesa, botao) {
  if (botao) botao.disabled = true;

  const sucesso = await tentarEncerrarSessao(mesa);

  if (!sucesso) {
    if (botao) botao.disabled = false;
    return;
  }

  pedidos = pedidos.filter(pedido => String(pedido.mesa) !== String(mesa));
  fechamentos = fechamentos.filter(f => String(f.mesa) !== String(mesa));
  mesasAtivas = mesasAtivas.filter(s => String(s.mesa) !== String(mesa));
  renderizarPedidos();
  await renderizarFechamentos();
  await renderizarMesasAtivas();
  atualizarMesaControleLocal(mesa, 'bloqueada');
}

mesasAtivasGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.mesa-ativa-card__fechar');
  if (!botao) return;
  const mesa = botao.dataset.mesa;
  pedirConfirmacaoSenha(() => fecharMesaDireto(mesa, botao));
});

// ========================================
// CONTROLE DE MESAS (liberação pós-fechamento)
// ========================================
//
// Toda mesa passa a ter status_mesa (liberada/bloqueada — ver
// supabase/019_bloqueio_mesa.sql). Um fechamento total (finalizarFechamento,
// fecharMesaDireto ou o encerramento automático em
// confirmarRecebimentoPagamento) bloqueia a mesa sozinho, no banco — aqui só
// refletimos isso na tela na hora, sem esperar recarregar. Mudanças feitas
// em OUTRO aparelho (outro balcão, ou garcom.html) chegam via o polling de
// listar_mesas_balcao lá embaixo (ver POLLING DE MESAS) — "mesas" não tem
// Realtime de propósito (token secreto). liberar_mesa é o
// único caminho de volta pra 'liberada', sempre sob toque explícito do
// garçom confirmando que tem gente sentada de verdade.
//
// Mostra TODAS as mesas, ativas ou não — inativa tem card simplificado (só
// número + status + botão "Ativar mesa"), já que status_mesa/sessão não
// importam pra uma mesa fora de circulação. Ativar/desativar aqui usa as
// mesmas RPCs que admin.html teria via update direto (ver
// supabase/020_ativar_desativar_mesa_balcao.sql) — as duas telas convivem.

function renderizarControleMesas() {
  const mesas = mesasControle;

  if (mesas.length === 0) {
    controleMesasVazio.style.display = 'block';
    controleMesasGrid.innerHTML = '';
    return;
  }

  controleMesasVazio.style.display = 'none';

  controleMesasGrid.innerHTML = mesas.map(mesa => {
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
      <button type="button" class="btn btn--secondary controle-mesa-card__desativar" data-mesa="${mesa.numero}">Desativar</button>
    </div>
  `;
  }).join('');
}

// Atualiza o status de UMA mesa em mesasControle (sem precisar recarregar
// listar_mesas_balcao inteira) e redesenha — usado tanto pelas ações locais
// (liberar_mesa, os três caminhos de fechamento total) quanto pelo evento
// de Realtime de outro aparelho (ver lidarComAtualizacaoSessao).
function atualizarMesaControleLocal(mesa, novoStatus) {
  const entrada = mesasControle.find(m => String(m.numero) === String(mesa));
  if (entrada) entrada.status_mesa = novoStatus;
  renderizarControleMesas();
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

// Ativa/desativa a mesa (mesas.ativa) direto do balcão — mesmo efeito de
// "Ativar"/"Desativar" em admin.html, só que sem precisar sair do balcão
// (ver supabase/020_ativar_desativar_mesa_balcao.sql). As duas ações
// convivem: o admin também pode continuar fazendo isso por lá.

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
  renderizarControleMesas();
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
  renderizarControleMesas();
}

controleMesasGrid.addEventListener('click', (event) => {
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

// ========================================
// AÇÕES EM MASSA (abertura/fechamento do salão) — ver
// supabase/022_mesas_em_massa.sql
// ========================================
//
// Depois de qualquer uma das duas, recarrega listar_mesas_balcao inteira em
// vez de tentar adivinhar localmente quem mudou — mais simples e sempre
// correto (as duas RPCs mexem em várias linhas de uma vez).

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
  renderizarControleMesas();
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
  renderizarControleMesas();

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
  renderizarControleMesas();
  mostrarToast(`${resultadoForcado.bloqueadas} ${resultadoForcado.bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'} (incluindo com conta aberta).`);
}

liberarTodasBtn.addEventListener('click', liberarTodasMesas);
bloquearTodasBtn.addEventListener('click', bloquearTodasMesas);

// Controle de Mesas mora num modal (igual Histórico) só pra não deixar a
// tela do balcão comprida — a lista em si (renderizarControleMesas) continua
// atualizando sozinha em tempo real mesmo com o modal fechado.
function abrirControleMesas() {
  controleMesasOverlay.classList.add('is-open');
  controleMesasModal.classList.add('is-open');
}

function fecharControleMesas() {
  controleMesasOverlay.classList.remove('is-open');
  controleMesasModal.classList.remove('is-open');
}

controleMesasBtn.addEventListener('click', abrirControleMesas);
controleMesasClose.addEventListener('click', fecharControleMesas);
controleMesasOverlay.addEventListener('click', fecharControleMesas);

// ========================================
// REALTIME (Supabase)
// ========================================

let canalRealtime = null;

// Um pedido novo chega sem os itens embutidos (o evento Realtime só traz as colunas
// da própria linha de "pedidos"), então busca os itens à parte antes de exibir.
async function lidarComInsercao(payload) {
  const novo = payload.new;

  if (novo.tipo === 'fechar_conta') {
    if (novo.status !== 'pendente') return;
    fechamentos.push(novo);
    await renderizarFechamentos();
    tocarBeep('fechamento');
    return;
  }

  if (novo.status !== 'pendente') return;

  const { data: itens, error } = await supabase
    .from('pedido_itens')
    .select('id, nome:nome_snapshot, preco:preco_unitario, quantidade')
    .eq('pedido_id', novo.id);

  pedidos.push({ ...novo, itens: error ? [] : itens });
  ordenarPedidos();
  renderizarPedidos();
  // O card de "Mesas Ativas" dessa mesa mostra os itens/total da sessão
  // inteira — precisa refletir esse pedido novo assim que ele chega.
  await renderizarMesasAtivas();
  tocarBeep('pedido');
}

// Cobre o caso de outro dispositivo/aba ter marcado "Entregue" ou "Conta Fechada"
// antes deste: tira da fila local pra não ficar dessincronizado.
function lidarComAtualizacao(payload) {
  const atualizado = payload.new;

  if (atualizado.tipo === 'fechar_conta') {
    if (atualizado.status !== 'pendente' && fechamentos.some(f => f.id === atualizado.id)) {
      fechamentos = fechamentos.filter(f => f.id !== atualizado.id);
      renderizarFechamentos();
    }
    return;
  }

  if (atualizado.status !== 'pendente' && pedidos.some(p => p.id === atualizado.id)) {
    pedidos = pedidos.filter(p => p.id !== atualizado.id);
    renderizarPedidos();
  }
}

// Um pagamento novo (de qualquer aparelho/aba) chega sem o número da mesa
// embutido (o evento Realtime só traz as colunas da própria linha de
// "pagamentos"), então busca a mesa à parte antes de exibir — mesmo padrão de
// lidarComInsercao pros itens do pedido.
async function lidarComInsercaoPagamento(payload) {
  const novo = payload.new;
  if (novo.status !== 'pendente') return;

  const { data: sessao, error: erroSessao } = await supabase.from('sessoes').select('mesa').eq('id', novo.sessao_id).single();
  if (erroSessao) console.error('Erro ao buscar mesa do pagamento novo:', erroSessao);

  pagamentosPendentes.push({ ...novo, mesa: sessao ? sessao.mesa : '?' });
  await renderizarPagamentosPendentes();
  // Um pagamento pendente novo já entra na conta de "aguardando confirmação"
  // do saldo da mesa (ver conta_da_mesa_balcao) — sem isso, "Falta" no card
  // de fechar conta e no de "Mesas Ativas" ficava desatualizado até outra
  // ação disparar um re-render.
  await renderizarFechamentos();
  await renderizarMesasAtivas();
  tocarBeep('fechamento');
}

// Cobre o caso de outro dispositivo/aba ter confirmado o recebimento antes deste.
async function lidarComAtualizacaoPagamento(payload) {
  const atualizado = payload.new;
  if (atualizado.status === 'confirmado' && pagamentosPendentes.some(p => p.id === atualizado.id)) {
    pagamentosPendentes = pagamentosPendentes.filter(p => p.id !== atualizado.id);
    await renderizarPagamentosPendentes();
    await renderizarFechamentos();
    await renderizarMesasAtivas();
  }
}

// Uma sessão nova (mesa recém-ocupada) entra em "Mesas Ativas" assim que o
// primeiro pedido dela é gravado (ver criar_pedido em supabase/008_sessoes.sql).
function lidarComInsercaoSessao(payload) {
  const novo = payload.new;
  if (novo.status !== 'aberta' || mesasAtivas.some(s => s.id === novo.id)) return;
  mesasAtivas.push(novo);
  renderizarMesasAtivas();
}

// Cobre o caso de a sessão ter sido encerrada (encerrar_sessao) por qualquer
// aparelho/aba: tira a mesa de "Mesas Ativas" sem precisar recarregar a página.
function lidarComAtualizacaoSessao(payload) {
  const atualizado = payload.new;
  if (atualizado.status !== 'aberta' && mesasAtivas.some(s => s.id === atualizado.id)) {
    mesasAtivas = mesasAtivas.filter(s => s.id !== atualizado.id);
    renderizarMesasAtivas();
    // "mesas" não está no Realtime (o token é secreto — ver comentário no
    // fim de supabase/019_bloqueio_mesa.sql), então é este evento de
    // "sessoes" fechando que avisa o Controle de Mesas em OUTRO
    // aparelho/aba que acabou de bloquear — encerrar_sessao e
    // confirmar_pagamento sempre bloqueiam a mesa na mesma transação em
    // que fecham a sessão.
    atualizarMesaControleLocal(atualizado.mesa, 'bloqueada');
  }
}

function inscreverRealtime() {
  canalRealtime = supabase
    .channel('balcao-pedidos')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, lidarComInsercao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, lidarComAtualizacao)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pagamentos' }, lidarComInsercaoPagamento)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pagamentos' }, lidarComAtualizacaoPagamento)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessoes' }, lidarComInsercaoSessao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes' }, lidarComAtualizacaoSessao)
    .subscribe((status) => {
      estadoCanal = status;
      recalcularIndicadorConexao();
    });
}

function desinscreverRealtime() {
  if (canalRealtime) {
    supabase.removeChannel(canalRealtime);
    canalRealtime = null;
  }
  estadoCanal = 'conectando';
}

// ========================================
// POLLING DE MESAS (cobre o que o Realtime de "sessoes" acima NÃO cobre)
// ========================================
//
// "mesas" (a tabela) não está publicada no Realtime, de propósito (o token
// é secreto — ver comentário no fim de supabase/019_bloqueio_mesa.sql; um
// evento Realtime manda a linha INTEIRA). lidarComAtualizacaoSessao (acima)
// já cobre o caso de fechamento total, mas liberar_mesa/ativar_mesa/
// desativar_mesa/liberar_todas_mesas/bloquear_todas_mesas feitos em OUTRO
// aparelho — inclusive garcom.html, ver mesmo esquema em js/garcom.js —
// não passam por "sessoes", então ficam invisíveis pro balcão até esse
// polling rodar. 5s dá resposta quase instantânea sem virar um polling
// pesado pro tamanho de um bar (poucos aparelhos consultando ao mesmo tempo).
// (INTERVALO_POLL_MESAS/pollMesasIntervalId ficam declaradas lá em cima,
// perto de mesasControle/mesasAtivas — ver comentário lá do motivo.)

async function reconsultarMesasControle() {
  try {
    await carregarMesasControle();
    renderizarControleMesas();
  } catch (erro) {
    // Silencioso de propósito: um poll que falha não deve interromper o
    // balcão com alert nenhum — o próximo poll tenta de novo sozinho.
    console.error('Erro no polling de mesas:', erro);
  }
}

function iniciarPollingMesas() {
  pararPollingMesas();
  pollMesasIntervalId = setInterval(reconsultarMesasControle, INTERVALO_POLL_MESAS);
}

function pararPollingMesas() {
  if (pollMesasIntervalId) {
    clearInterval(pollMesasIntervalId);
    pollMesasIntervalId = null;
  }
}

// ========================================
// HISTÓRICO DE PEDIDOS
// ========================================

const statusLabel = {
  pendente: 'Pendente',
  entregue: 'Entregue',
  finalizado: 'Finalizado',
};

// Busca só os pedidos dentro da janela pedida: um dia específico, se o filtro
// estiver preenchido, ou os últimos 30 dias por padrão — em vez do histórico
// inteiro do bar (que só cresce, sem limite, a cada dia que passa). O filtro é
// aplicado direto na consulta (não mais no navegador depois de baixar tudo).
// As datas de início/fim são instantes de meia-noite LOCAL (mesmo fuso de quem
// está usando o balcão — o bar em si), então bate certo com o dia civil de
// quem está filtrando, sem precisar converter fuso horário aqui.
async function carregarHistoricoBruto(filtro) {
  let inicio;
  let fim;

  if (filtro) {
    const [ano, mes, dia] = filtro.split('-').map(Number);
    inicio = new Date(ano, mes - 1, dia, 0, 0, 0, 0);
    fim = new Date(ano, mes - 1, dia + 1, 0, 0, 0, 0);
  } else {
    fim = new Date();
    fim.setHours(24, 0, 0, 0); // meia-noite de amanhã: inclui o dia de hoje inteiro
    inicio = new Date(fim);
    inicio.setDate(inicio.getDate() - 30);
  }

  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, total, status, criado_em, itens:pedido_itens(nome:nome_snapshot, preco:preco_unitario, quantidade)')
    .eq('tipo', 'pedido')
    .gte('criado_em', inicio.toISOString())
    .lt('criado_em', fim.toISOString())
    .order('criado_em', { ascending: false });

  if (error) {
    console.error('Erro ao carregar histórico:', error);
    return null;
  }
  return data;
}

async function renderizarHistorico() {
  const filtro = historicoFiltroData.value;

  historicoLista.innerHTML = '';
  historicoVazio.textContent = 'Carregando...';
  historicoVazio.style.display = 'block';

  const historico = await carregarHistoricoBruto(filtro);

  if (historico === null) {
    historicoVazio.textContent = 'Não foi possível carregar o histórico agora. Verifique sua conexão.';
    historicoVazio.style.display = 'block';
    return;
  }

  if (historico.length === 0) {
    historicoVazio.textContent = filtro
      ? 'Nenhum pedido registrado nessa data.'
      : 'Nenhum pedido nos últimos 30 dias.';
    historicoVazio.style.display = 'block';
    historicoLista.innerHTML = '';
    return;
  }

  historicoVazio.style.display = 'none';
  historicoLista.innerHTML = historico.map(pedido => `
    <div class="historico-pedido">
      <div class="historico-pedido__header">
        <span class="historico-pedido__mesa">Mesa ${pedido.mesa}</span>
        <span class="historico-pedido__horario">${formatarData(pedido.criado_em)} às ${formatarHorario(pedido.criado_em)}</span>
      </div>
      <span class="historico-pedido__status historico-pedido__status--${pedido.status}">${statusLabel[pedido.status] || pedido.status}</span>
      <ul class="pedido-card__itens">
        ${pedido.itens.map(item => `
          <li>
            <span>${item.quantidade}x ${item.nome}</span>
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
      <div class="pedido-card__total">Total: ${formatarPreco(pedido.total)}</div>
    </div>
  `).join('');
}

function abrirHistorico() {
  renderizarHistorico();
  historicoOverlay.classList.add('is-open');
  historicoModal.classList.add('is-open');
}

function fecharHistorico() {
  historicoOverlay.classList.remove('is-open');
  historicoModal.classList.remove('is-open');
}

historicoBtn.addEventListener('click', abrirHistorico);
historicoClose.addEventListener('click', fecharHistorico);
historicoOverlay.addEventListener('click', fecharHistorico);
historicoFiltroData.addEventListener('change', renderizarHistorico);
historicoFiltroLimpar.addEventListener('click', () => {
  historicoFiltroData.value = '';
  renderizarHistorico();
});

// Esc fecha o modal de histórico ou o de controle de mesas (o que estiver
// aberto) e devolve o foco pro botão que o abriu
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  if (historicoModal.classList.contains('is-open')) {
    fecharHistorico();
    historicoBtn.focus();
  } else if (controleMesasModal.classList.contains('is-open')) {
    fecharControleMesas();
    controleMesasBtn.focus();
  }
});
