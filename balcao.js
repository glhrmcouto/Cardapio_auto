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
import { formatarPreco, formatarDataISO, escaparTexto } from './shared.js';

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

const historicoBtn = document.getElementById('historicoBtn');
const historicoOverlay = document.getElementById('historicoOverlay');
const historicoModal = document.getElementById('historicoModal');
const historicoLista = document.getElementById('historicoLista');
const historicoVazio = document.getElementById('historicoVazio');
const historicoClose = document.getElementById('historicoClose');
const historicoFiltroData = document.getElementById('historicoFiltroData');
const historicoFiltroLimpar = document.getElementById('historicoFiltroLimpar');

const STATUS_LABEL_PESSOA = { em_aberto: 'Em aberto', aguardando: 'Aguardando', pago: 'Pago' };

let pedidos = []; // só os pedidos com status "pendente" — cada um já vem com .itens embutido
let fechamentos = []; // pedidos de "fechar conta" (mesa inteira) ainda não atendidos
let pagamentosPendentes = []; // pagamentos parciais ("fechar minha parte") ainda não confirmados

function formatarHorario(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Data local no formato yyyy-mm-dd, pra comparar com o valor do <input type="date">
function obterDataLocal(iso) {
  return formatarDataISO(new Date(iso));
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
    balcaoIniciado = false;
    pedidos = [];
    fechamentos = [];
    pagamentosPendentes = [];
    renderizarPedidos();
    fechamentoGrid.innerHTML = '';
    pagamentoGrid.innerHTML = '';
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
    .select('id, mesa, total, status, criado_em, cliente_nome, itens:pedido_itens(nome:nome_snapshot, preco:preco_unitario, quantidade)')
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

async function carregarTudoInicial() {
  balcaoErroEl.style.display = 'none';

  try {
    await Promise.all([
      carregarPedidosPendentes(),
      carregarFechamentosPendentes(),
      carregarPagamentosPendentes(),
    ]);
  } catch (erro) {
    console.error('Erro ao carregar pedidos/fechamentos:', erro);
    balcaoGrid.innerHTML = '';
    fechamentoGrid.innerHTML = '';
    pagamentoGrid.innerHTML = '';
    balcaoVazio.style.display = 'none';
    balcaoErroEl.style.display = 'block';
    return;
  }

  renderizarPedidos();
  await renderizarPagamentosPendentes();
  await renderizarFechamentos();
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
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
      <div class="pedido-card__total">Total: ${formatarPreco(pedido.total)}</div>
      <button class="btn btn--primary pedido-card__entregar" data-id="${pedido.id}">Entregue</button>
    </div>
  `).join('');
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
  const botao = event.target.closest('.pedido-card__entregar');
  if (!botao) return;
  marcarComoEntregue(botao.dataset.id);
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
  renderizarPedidos();
  await renderizarFechamentos();
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

  const { error } = await supabase.rpc('confirmar_pagamento', { p_pagamento_id: id });

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
  await renderizarPagamentosPendentes();
}

pagamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pagamento-card__ok');
  if (!botao) return;
  confirmarRecebimentoPagamento(botao.dataset.id);
});

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
    .select('nome:nome_snapshot, preco:preco_unitario, quantidade')
    .eq('pedido_id', novo.id);

  pedidos.push({ ...novo, itens: error ? [] : itens });
  ordenarPedidos();
  renderizarPedidos();
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

  const { data: sessao } = await supabase.from('sessoes').select('mesa').eq('id', novo.sessao_id).single();
  pagamentosPendentes.push({ ...novo, mesa: sessao ? sessao.mesa : '?' });
  await renderizarPagamentosPendentes();
  tocarBeep('fechamento');
}

// Cobre o caso de outro dispositivo/aba ter confirmado o recebimento antes deste.
function lidarComAtualizacaoPagamento(payload) {
  const atualizado = payload.new;
  if (atualizado.status === 'confirmado' && pagamentosPendentes.some(p => p.id === atualizado.id)) {
    pagamentosPendentes = pagamentosPendentes.filter(p => p.id !== atualizado.id);
    renderizarPagamentosPendentes();
  }
}

function inscreverRealtime() {
  canalRealtime = supabase
    .channel('balcao-pedidos')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, lidarComInsercao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, lidarComAtualizacao)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pagamentos' }, lidarComInsercaoPagamento)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pagamentos' }, lidarComAtualizacaoPagamento)
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
// HISTÓRICO DE PEDIDOS
// ========================================

const statusLabel = {
  pendente: 'Pendente',
  entregue: 'Entregue',
  finalizado: 'Finalizado',
};

// Busca TODOS os pedidos (tipo "pedido", qualquer status) direto do Supabase — o filtro
// por data é aplicado depois, no navegador, com base no fuso local (mesma lógica de sempre,
// pra não desalinhar o dia por causa de fuso horário na comparação feita no banco).
async function carregarHistoricoBruto() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, total, status, criado_em, itens:pedido_itens(nome:nome_snapshot, preco:preco_unitario, quantidade)')
    .eq('tipo', 'pedido')
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

  const historicoCompleto = await carregarHistoricoBruto();

  if (historicoCompleto === null) {
    historicoVazio.textContent = 'Não foi possível carregar o histórico agora. Verifique sua conexão.';
    historicoVazio.style.display = 'block';
    return;
  }

  const historico = filtro
    ? historicoCompleto.filter(pedido => obterDataLocal(pedido.criado_em) === filtro)
    : historicoCompleto;

  if (historico.length === 0) {
    historicoVazio.textContent = filtro
      ? 'Nenhum pedido registrado nessa data.'
      : 'Nenhum pedido registrado ainda.';
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

// Esc fecha o modal de histórico e devolve o foco pro botão que o abriu
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && historicoModal.classList.contains('is-open')) {
    fecharHistorico();
    historicoBtn.focus();
  }
});
