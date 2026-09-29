import { supabase } from '../supabaseClient.js';
import { formatarPreco } from '../shared.js';
import { formatarData, formatarHorario, htmlListaItens } from './conta.js';

export const historicoBtn = document.getElementById('historicoBtn');
const historicoOverlay = document.getElementById('historicoOverlay');
export const historicoModal = document.getElementById('historicoModal');
const historicoLista = document.getElementById('historicoLista');
const historicoVazio = document.getElementById('historicoVazio');
const historicoClose = document.getElementById('historicoClose');
const historicoFiltroData = document.getElementById('historicoFiltroData');
const historicoFiltroLimpar = document.getElementById('historicoFiltroLimpar');

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
      ${htmlListaItens(pedido.itens)}
      <div class="pedido-card__total">Total: ${formatarPreco(pedido.total)}</div>
    </div>
  `).join('');
}

function abrirHistorico() {
  renderizarHistorico();
  historicoOverlay.classList.add('is-open');
  historicoModal.classList.add('is-open');
}

export function fecharHistorico() {
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
