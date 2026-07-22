// ========================================
// TELA DO BALCÃO — recebe os pedidos do cardápio em tempo real
// ========================================
//
// Igual ao script.js do cardápio: hoje a comunicação é feita via BroadcastChannel
// (só funciona entre abas/telas do MESMO navegador/dispositivo) + localStorage
// (garante que o balcão veja os pedidos mesmo se essa tela abrir depois de o
// pedido ter sido feito). Se o cardápio e o balcão precisarem rodar em aparelhos
// diferentes, essa camada pode ser trocada por Firebase Realtime Database/Firestore
// ou Supabase Realtime, mantendo a mesma estrutura do objeto "pedido".
const canalPedidos = new BroadcastChannel('aooba_pedidos');

const balcaoGrid = document.getElementById('balcaoGrid');
const balcaoVazio = document.getElementById('balcaoVazio');
const contadorPedidos = document.getElementById('contadorPedidos');
const fechamentoGrid = document.getElementById('fechamentoGrid');

const historicoBtn = document.getElementById('historicoBtn');
const historicoOverlay = document.getElementById('historicoOverlay');
const historicoModal = document.getElementById('historicoModal');
const historicoLista = document.getElementById('historicoLista');
const historicoVazio = document.getElementById('historicoVazio');
const historicoClose = document.getElementById('historicoClose');
const historicoFiltroData = document.getElementById('historicoFiltroData');
const historicoFiltroLimpar = document.getElementById('historicoFiltroLimpar');

let pedidos = []; // só os pedidos com status "pendente"
let fechamentos = []; // pedidos de "fechar conta" ainda não atendidos

function formatarPreco(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarHorario(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Data local no formato yyyy-mm-dd, pra comparar com o valor do <input type="date">
function obterDataLocal(iso) {
  const d = new Date(iso);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

const ativarSomBtn = document.getElementById('ativarSomBtn');
const somAvisoEl = document.getElementById('somAviso');

// Um único AudioContext reaproveitado em todos os beeps — criar um novo a cada chamada
// esgota o limite de contextos simultâneos do navegador e o áudio acaba morrendo.
let audioCtx = null;

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

// Toca o beep de "pedido novo" (agudo, único) ou de "fechar conta" (mais grave e duplo).
// O contexto nasce "suspended" (a tela abre sem interação do usuário) — nesse caso,
// em vez de engolir o erro em silêncio, mostra o aviso pra o garçom clicar em "Ativar som".
function tocarBeep(tipo = 'pedido') {
  const ctx = obterAudioContext();

  if (ctx.state === 'suspended') {
    mostrarAvisoSom();
    return;
  }

  if (tipo === 'fechamento') {
    tocarTom(ctx, 440, 0, 0.16);
    tocarTom(ctx, 440, 0.22, 0.16);
  } else {
    tocarTom(ctx, 880, 0, 0.18);
  }
}

// Ao clicar, "destrava" o AudioContext (resume) e confirma com um beep de teste
if (ativarSomBtn) {
  ativarSomBtn.addEventListener('click', () => {
    const ctx = obterAudioContext();
    ctx.resume().then(() => {
      tocarTom(ctx, 880, 0, 0.18);
      ativarSomBtn.textContent = '🔔 Som ativo';
      ativarSomBtn.disabled = true;
      if (somAvisoEl) somAvisoEl.classList.remove('show');
    });
  });
}

// Carrega do localStorage só os pedidos que ainda estão pendentes, do mais antigo pro mais novo
function carregarPedidosDoStorage() {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  pedidos = salvos.filter(pedido => pedido.status === 'pendente');
  ordenarPedidos();
}

function ordenarPedidos() {
  pedidos.sort((a, b) => new Date(a.horario) - new Date(b.horario));
}

// Atualiza o status de um pedido salvo (usado quando o garçom marca como entregue)
function atualizarStatusNoStorage(id, novoStatus) {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  const atualizados = salvos.map(pedido =>
    pedido.id === id ? { ...pedido, status: novoStatus } : pedido
  );
  localStorage.setItem('aooba_pedidos', JSON.stringify(atualizados));
}

// Soma o total dos pedidos ainda ativos (pendente/entregue) feitos por uma mesa,
// pra o garçom saber quanto cobrar ao fechar a conta.
// Ignora "finalizado" senão uma mesa reaproveitada soma o consumo de clientes anteriores.
function calcularTotalMesa(mesa) {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  return salvos
    .filter(pedido =>
      (pedido.tipo === 'pedido' || !pedido.tipo) &&
      String(pedido.mesa) === String(mesa) &&
      pedido.status !== 'finalizado'
    )
    .reduce((soma, pedido) => soma + pedido.total, 0);
}

// Junta os itens dos pedidos ainda ativos (pendente/entregue) de uma mesa e agrupa por nome
// (somando quantidades repetidas), pra o garçom ver o que foi consumido antes de fechar a conta.
// Ignora "finalizado" pelo mesmo motivo de calcularTotalMesa.
function obterItensDaMesa(mesa) {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  const pedidosDaMesa = salvos.filter(pedido =>
    (pedido.tipo === 'pedido' || !pedido.tipo) &&
    String(pedido.mesa) === String(mesa) &&
    pedido.status !== 'finalizado'
  );

  const itensAgrupados = {};
  pedidosDaMesa.forEach(pedido => {
    pedido.itens.forEach(item => {
      if (!itensAgrupados[item.nome]) {
        itensAgrupados[item.nome] = { nome: item.nome, quantidade: 0, preco: item.preco };
      }
      itensAgrupados[item.nome].quantidade += item.quantidade;
    });
  });

  return Object.values(itensAgrupados);
}

// Conta quantos pedidos de uma mesa ainda estão "pendente" (não entregues),
// pra avisar o garçom antes de fechar a conta e apagar esses pedidos da fila
function contarPedidosPendentesDaMesa(mesa) {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  return salvos.filter(pedido =>
    (pedido.tipo === 'pedido' || !pedido.tipo) &&
    String(pedido.mesa) === String(mesa) &&
    pedido.status === 'pendente'
  ).length;
}

// Carrega do localStorage só os fechamentos de conta ainda pendentes
function carregarFechamentosDoStorage() {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  fechamentos = salvos.filter(item => item.tipo === 'fechar_conta' && item.status === 'pendente');
}

// Atualiza o status de um fechamento salvo (usado quando o garçom marca a conta como atendida)
function atualizarStatusFechamentoNoStorage(id, novoStatus) {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  const atualizados = salvos.map(item =>
    item.id === id && item.tipo === 'fechar_conta' ? { ...item, status: novoStatus } : item
  );
  localStorage.setItem('aooba_pedidos', JSON.stringify(atualizados));
}

// Marca todos os pedidos de uma mesa como "finalizado" (chamado ao fechar a conta)
function marcarPedidosMesaComoFinalizados(mesa) {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  const atualizados = salvos.map(pedido =>
    String(pedido.mesa) === String(mesa) ? { ...pedido, status: 'finalizado' } : pedido
  );
  localStorage.setItem('aooba_pedidos', JSON.stringify(atualizados));
}

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
        <div class="pedido-card__horario">${formatarHorario(pedido.horario)}</div>
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

// Remove o pedido da fila e grava o novo status no localStorage
function marcarComoEntregue(id) {
  pedidos = pedidos.filter(pedido => pedido.id !== id);
  atualizarStatusNoStorage(id, 'entregue');
  renderizarPedidos();
}

balcaoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pedido-card__entregar');
  if (!botao) return;
  marcarComoEntregue(botao.dataset.id);
});

// Desenha os alertas de "fechar conta" pendentes, com o total já calculado
function renderizarFechamentos() {
  fechamentoGrid.innerHTML = fechamentos.map(fechamento => {
    const itens = obterItensDaMesa(fechamento.mesa);
    const pendentes = contarPedidosPendentesDaMesa(fechamento.mesa);
    return `
    <div class="fechamento-card" data-id="${fechamento.id}">
      <span class="fechamento-card__icon">⚠️</span>
      <div class="fechamento-card__mesa">MESA ${fechamento.mesa} — FECHAR CONTA</div>
      <div class="fechamento-card__horario">${formatarHorario(fechamento.horario)}</div>
      ${pendentes > 0 ? `<div class="fechamento-card__aviso-pendente">⚠️ Esta mesa tem ${pendentes} pedido(s) ainda não entregue(s)</div>` : ''}
      <ul class="pedido-card__itens">
        ${itens.map(item => `
          <li>
            <span>${item.quantidade}x ${item.nome}</span>
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
      <div class="fechamento-card__total">Total a cobrar: ${formatarPreco(calcularTotalMesa(fechamento.mesa))}</div>
      <button class="btn btn--primary fechamento-card__fechar" data-id="${fechamento.id}">Conta Fechada</button>
    </div>
  `;
  }).join('');
}

// Remove o alerta da tela, marca os pedidos da mesa como finalizados e tira da fila em
// memória os pedidos que ainda estavam pendentes (senão a tela fica dessincronizada do storage)
function finalizarFechamento(id) {
  const fechamento = fechamentos.find(f => f.id === id);
  if (!fechamento) return;

  const pendentes = contarPedidosPendentesDaMesa(fechamento.mesa);
  if (pendentes > 0) {
    const confirmou = confirm(
      `Mesa ${fechamento.mesa} tem ${pendentes} pedido(s) ainda não entregue(s). Fechar a conta mesmo assim?`
    );
    if (!confirmou) return;
  }

  fechamentos = fechamentos.filter(f => f.id !== id);
  renderizarFechamentos();

  marcarPedidosMesaComoFinalizados(fechamento.mesa);
  atualizarStatusFechamentoNoStorage(id, 'atendido');

  pedidos = pedidos.filter(pedido => String(pedido.mesa) !== String(fechamento.mesa));
  renderizarPedidos();
}

fechamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.fechamento-card__fechar');
  if (!botao) return;
  finalizarFechamento(botao.dataset.id);
});

// Escuta pedidos e fechamentos de conta chegando em tempo real (sem recarregar a página)
canalPedidos.onmessage = (event) => {
  const dados = event.data;

  if (dados.tipo === 'fechar_conta') {
    if (fechamentos.some(f => f.id === dados.id)) return; // evita duplicar se já veio do storage
    fechamentos.push(dados);
    renderizarFechamentos();
    tocarBeep('fechamento');
    return;
  }

  pedidos.push(dados);
  ordenarPedidos();
  renderizarPedidos();
  tocarBeep('pedido');
};

// ========================================
// HISTÓRICO DE PEDIDOS
// ========================================

const statusLabel = {
  pendente: 'Pendente',
  entregue: 'Entregue',
  finalizado: 'Finalizado',
};

// Lê todos os pedidos já feitos (qualquer status), do mais recente pro mais antigo
function carregarHistorico() {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  return salvos
    .filter(pedido => pedido.tipo === 'pedido' || !pedido.tipo)
    .sort((a, b) => new Date(b.horario) - new Date(a.horario));
}

function renderizarHistorico() {
  const filtro = historicoFiltroData.value;
  let historico = carregarHistorico();

  if (filtro) {
    historico = historico.filter(pedido => obterDataLocal(pedido.horario) === filtro);
  }

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
        <span class="historico-pedido__horario">${formatarData(pedido.horario)} às ${formatarHorario(pedido.horario)}</span>
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

carregarPedidosDoStorage();
carregarFechamentosDoStorage();
renderizarPedidos();
renderizarFechamentos();
