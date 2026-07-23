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
import { formatarPreco, formatarDataISO } from './shared.js';

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
const individualGrid = document.getElementById('individualGrid');

const historicoBtn = document.getElementById('historicoBtn');
const historicoOverlay = document.getElementById('historicoOverlay');
const historicoModal = document.getElementById('historicoModal');
const historicoLista = document.getElementById('historicoLista');
const historicoVazio = document.getElementById('historicoVazio');
const historicoClose = document.getElementById('historicoClose');
const historicoFiltroData = document.getElementById('historicoFiltroData');
const historicoFiltroLimpar = document.getElementById('historicoFiltroLimpar');

let pedidos = []; // só os pedidos com status "pendente" — cada um já vem com .itens embutido
let fechamentos = []; // pedidos de "fechar conta" (mesa inteira) ainda não atendidos
let fechamentosIndividuais = []; // fechamentos parciais ("fechar só a minha conta") ainda não confirmados

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
    fechamentosIndividuais = [];
    renderizarPedidos();
    fechamentoGrid.innerHTML = '';
    individualGrid.innerHTML = '';
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

async function carregarFechamentosIndividuaisPendentes() {
  const { data, error } = await supabase
    .from('fechamentos_individuais')
    .select('id, mesa, cliente_nome, subtotal, taxa_servico, total, criado_em')
    .eq('atendido', false)
    .order('criado_em', { ascending: true });

  if (error) throw error;
  fechamentosIndividuais = data;
}

async function carregarTudoInicial() {
  balcaoErroEl.style.display = 'none';

  try {
    await Promise.all([
      carregarPedidosPendentes(),
      carregarFechamentosPendentes(),
      carregarFechamentosIndividuaisPendentes(),
    ]);
  } catch (erro) {
    console.error('Erro ao carregar pedidos/fechamentos:', erro);
    balcaoGrid.innerHTML = '';
    fechamentoGrid.innerHTML = '';
    individualGrid.innerHTML = '';
    balcaoVazio.style.display = 'none';
    balcaoErroEl.style.display = 'block';
    return;
  }

  renderizarPedidos();
  renderizarFechamentosIndividuais();
  await renderizarFechamentos();
}

balcaoTentarBtn.addEventListener('click', carregarTudoInicial);

function ordenarPedidos() {
  pedidos.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
}

// Itens + subtotal + taxa de serviço (10%) + total consolidado da SESSÃO ABERTA
// da mesa, já com o subtotal por pessoa (rateio dos itens compartilhados
// aplicado no banco). Usa a RPC conta_da_mesa_balcao (ver
// supabase/008_sessoes.sql) em vez de consultar a tabela direto, porque o
// rateio por pessoa é lógica de negócio melhor mantida num só lugar (o banco),
// não duplicada aqui e na RPC do cliente (conta_da_mesa).
async function obterContaAtivaDaMesa(mesa) {
  const { data, error } = await supabase.rpc('conta_da_mesa_balcao', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao consultar itens da mesa:', error);
    return { itens: [], subtotal: 0, taxaServico: 0, total: 0, porPessoa: [] };
  }

  return {
    itens: data.itens,
    subtotal: data.subtotal,
    taxaServico: data.taxa_servico,
    total: data.total,
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
        ${pedido.cliente_nome ? `<div class="pedido-card__cliente">${pedido.cliente_nome}</div>` : ''}
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
      <div class="fechamento-card__resumo">
        <div class="fechamento-card__linha"><span>Subtotal</span><span>${formatarPreco(conta.subtotal)}</span></div>
        <div class="fechamento-card__linha"><span>Taxa de serviço (10%)</span><span>${formatarPreco(conta.taxaServico)}</span></div>
      </div>
      ${conta.porPessoa.length > 1 ? `
        <div class="fechamento-card__pessoas">
          <div class="fechamento-card__pessoas-titulo">Subtotal por pessoa</div>
          ${conta.porPessoa.map(pessoa => `
            <div class="fechamento-card__linha"><span>${pessoa.nome}</span><span>${formatarPreco(pessoa.subtotal)}</span></div>
          `).join('')}
        </div>
      ` : ''}
      <div class="fechamento-card__total">Total a cobrar: ${formatarPreco(conta.total)}</div>
      <button class="btn btn--primary fechamento-card__fechar" data-id="${fechamento.id}">Conta Fechada</button>
    </div>
  `;
  }));

  fechamentoGrid.innerHTML = cards.join('');
}

// Remove o alerta da tela e chama a RPC encerrar_sessao (ver supabase/008_sessoes.sql),
// que marca a sessão da mesa como fechada e todos os pedidos dela (consumo +
// fechar_conta) como finalizado — substitui os dois updates manuais que este
// arquivo fazia antes.
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

  try {
    const { error } = await supabase.rpc('encerrar_sessao', { p_mesa: fechamento.mesa });
    if (error) throw error;

    fechamentos = fechamentos.filter(f => f.id !== id);
    pedidos = pedidos.filter(pedido => String(pedido.mesa) !== String(fechamento.mesa));
    renderizarPedidos();
    await renderizarFechamentos();
  } catch (erro) {
    console.error('Erro ao finalizar fechamento:', erro);
    alert('Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
    if (botao) botao.disabled = false;
  }
}

fechamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.fechamento-card__fechar');
  if (!botao) return;
  finalizarFechamento(botao.dataset.id);
});

// ========================================
// FECHAMENTO INDIVIDUAL ("fechar só a minha conta")
// ========================================
//
// Diferente do fechamento da mesa inteira: não mexe em pedidos nem em sessão,
// só avisa que aquela pessoa já pagou a parte dela. "Recebido" marca
// atendido = true (update direto, mesmo padrão de marcarComoEntregue) — não
// precisa de RPC porque não há regra de negócio pra validar, só um flag.

function renderizarFechamentosIndividuais() {
  individualGrid.innerHTML = fechamentosIndividuais.map(fechamento => `
    <div class="individual-card" data-id="${fechamento.id}">
      <div class="individual-card__mesa">Mesa ${fechamento.mesa} — fechamento individual</div>
      <div class="individual-card__nome">${fechamento.cliente_nome}</div>
      <div class="individual-card__horario">${formatarHorario(fechamento.criado_em)}</div>
      <div class="individual-card__linha"><span>Subtotal</span><span>${formatarPreco(fechamento.subtotal)}</span></div>
      <div class="individual-card__linha"><span>Taxa de serviço (10%)</span><span>${formatarPreco(fechamento.taxa_servico)}</span></div>
      <div class="individual-card__total">Total a cobrar: ${formatarPreco(fechamento.total)}</div>
      <button class="btn btn--primary individual-card__ok" data-id="${fechamento.id}">Recebido</button>
    </div>
  `).join('');
}

async function marcarFechamentoIndividualRecebido(id) {
  const botao = individualGrid.querySelector(`.individual-card__ok[data-id="${id}"]`);
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Marcando...';
  }

  const { error } = await supabase
    .from('fechamentos_individuais')
    .update({ atendido: true, atendido_em: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('Erro ao marcar fechamento individual como recebido:', error);
    alert('Não foi possível marcar como recebido agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Recebido';
    }
    return;
  }

  fechamentosIndividuais = fechamentosIndividuais.filter(f => f.id !== id);
  renderizarFechamentosIndividuais();
}

individualGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.individual-card__ok');
  if (!botao) return;
  marcarFechamentoIndividualRecebido(botao.dataset.id);
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

// Um fechamento individual novo (de qualquer aparelho/aba) entra direto na tela;
// se ele já chegar "atendido" (não deveria, mas por segurança) é ignorado.
function lidarComInsercaoIndividual(payload) {
  const novo = payload.new;
  if (novo.atendido) return;
  fechamentosIndividuais.push(novo);
  renderizarFechamentosIndividuais();
  tocarBeep('fechamento');
}

// Cobre o caso de outro dispositivo/aba ter marcado "Recebido" antes deste.
function lidarComAtualizacaoIndividual(payload) {
  const atualizado = payload.new;
  if (atualizado.atendido && fechamentosIndividuais.some(f => f.id === atualizado.id)) {
    fechamentosIndividuais = fechamentosIndividuais.filter(f => f.id !== atualizado.id);
    renderizarFechamentosIndividuais();
  }
}

function inscreverRealtime() {
  canalRealtime = supabase
    .channel('balcao-pedidos')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, lidarComInsercao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, lidarComAtualizacao)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fechamentos_individuais' }, lidarComInsercaoIndividual)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fechamentos_individuais' }, lidarComAtualizacaoIndividual)
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
