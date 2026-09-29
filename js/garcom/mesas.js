import { supabase } from '../supabaseClientGarcom.js';
import { criarControleMesas } from '../controle-mesas.js';
import { estado } from './estado.js';

const mesasCarregandoEl = document.getElementById('mesasCarregando');
const mesasErroEl = document.getElementById('mesasErro');
const mesasTentarBtn = document.getElementById('mesasTentar');
const mesasVazioEl = document.getElementById('mesasVazio');
export const mesasGrid = document.getElementById('mesasGrid');

// ========================================================================
// ABA MESAS — lista, ações por mesa e em massa (reaproveita listar_mesas_balcao,
// liberar_mesa, ativar_mesa, desativar_mesa, liberar_todas_mesas e
// bloquear_todas_mesas, todas já existentes; ver comentário de REALTIME DA
// ABA MESAS no topo do arquivo pra como isso fica sincronizado com o balcão)
// ========================================================================

// Lista de mesas + ações de liberar/ativar/desativar/em massa — compartilhado
// com a outra tela de salão (ver js/controle-mesas.js).
export const controleMesas = criarControleMesas({ cliente: supabase, redesenhar: () => renderizarMesas() });

// Toda mesa com sessão aberta agora (ver supabase/008_sessoes.sql) — usada
// só pro selo "Sessão aberta" no card; a decisão de pular mesa no bloqueio
// em massa é feita no banco (bloquear_todas_mesas), não aqui.
export async function carregarMesasAtivas() {
  const { data, error } = await supabase
    .from('sessoes')
    .select('id, mesa')
    .eq('status', 'aberta');

  if (error) throw error;
  estado.mesasAtivas = data;
}

export async function carregarMesasIniciais() {
  mesasCarregandoEl.style.display = 'block';
  mesasErroEl.style.display = 'none';
  mesasGrid.innerHTML = '';

  try {
    await Promise.all([controleMesas.carregar(), carregarMesasAtivas()]);
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
export function renderizarMesas() {
  if (controleMesas.mesas.length === 0) {
    mesasVazioEl.style.display = 'block';
    mesasGrid.innerHTML = '';
    return;
  }

  mesasVazioEl.style.display = 'none';

  mesasGrid.innerHTML = controleMesas.mesas.map(mesa => {
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
      ${estado.papelUsuario === 'garcom' ? `<button type="button" class="btn btn--primary controle-mesa-card__novo-pedido" data-mesa="${mesa.numero}">Novo pedido</button>` : ''}
      ${temSessaoAberta ? `<button type="button" class="btn btn--secondary controle-mesa-card__ver-conta" data-mesa="${mesa.numero}">Ver conta</button>` : ''}
      ${bloqueada ? `<button type="button" class="btn btn--secondary controle-mesa-card__liberar" data-mesa="${mesa.numero}">Liberar mesa</button>` : ''}
      <button type="button" class="btn btn--secondary controle-mesa-card__desativar" data-mesa="${mesa.numero}">Desativar mesa</button>
    </div>
  `;
  }).join('');
}

