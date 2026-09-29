import { supabase } from '../supabaseClient.js';
import { criarControleMesas } from '../controle-mesas.js';
import { estado } from './estado.js';

export const controleMesasGrid = document.getElementById('controleMesasGrid');
const controleMesasVazio = document.getElementById('controleMesasVazio');
export const controleMesasBtn = document.getElementById('controleMesasBtn');
const controleMesasOverlay = document.getElementById('controleMesasOverlay');
export const controleMesasModal = document.getElementById('controleMesasModal');
const controleMesasClose = document.getElementById('controleMesasClose');

// Lista de mesas + ações de liberar/ativar/desativar/em massa — compartilhado
// com a outra tela de salão (ver js/controle-mesas.js).
export const controleMesas = criarControleMesas({ cliente: supabase, redesenhar: () => renderizarControleMesas() });

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

export function renderizarControleMesas() {
  const mesas = controleMesas.mesas;

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
    const temSessaoAberta = estado.mesasAtivas.some(s => String(s.mesa) === String(mesa.numero));

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

// Ativa/desativa a mesa (mesas.ativa) direto do balcão — mesmo efeito de
// "Ativar"/"Desativar" em admin.html, só que sem precisar sair do balcão
// (ver supabase/020_ativar_desativar_mesa_balcao.sql). As duas ações
// convivem: o admin também pode continuar fazendo isso por lá.

controleMesasGrid.addEventListener('click', (event) => {
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
  }
});

// Controle de Mesas mora num modal (igual Histórico) só pra não deixar a
// tela do balcão comprida — a lista em si (renderizarControleMesas) continua
// atualizando sozinha em tempo real mesmo com o modal fechado.
function abrirControleMesas() {
  controleMesasOverlay.classList.add('is-open');
  controleMesasModal.classList.add('is-open');
}

export function fecharControleMesas() {
  controleMesasOverlay.classList.remove('is-open');
  controleMesasModal.classList.remove('is-open');
}

controleMesasBtn.addEventListener('click', abrirControleMesas);
controleMesasClose.addEventListener('click', fecharControleMesas);
controleMesasOverlay.addEventListener('click', fecharControleMesas);

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

const INTERVALO_POLL_MESAS = 5000;
let pollMesasIntervalId = null;

async function reconsultarMesasControle() {
  try {
    await controleMesas.carregar();
    renderizarControleMesas();
  } catch (erro) {
    // Silencioso de propósito: um poll que falha não deve interromper o
    // balcão com alert nenhum — o próximo poll tenta de novo sozinho.
    console.error('Erro no polling de mesas:', erro);
  }
}

export function iniciarPollingMesas() {
  pararPollingMesas();
  pollMesasIntervalId = setInterval(reconsultarMesasControle, INTERVALO_POLL_MESAS);
}

export function pararPollingMesas() {
  if (pollMesasIntervalId) {
    clearInterval(pollMesasIntervalId);
    pollMesasIntervalId = null;
  }
}
