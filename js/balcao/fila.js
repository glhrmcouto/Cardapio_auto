import { supabase } from '../supabaseClient.js';
import { formatarPreco, escaparTexto } from '../shared.js';
import { estado } from './estado.js';
import { formatarHorario, htmlListaItens } from './conta.js';

export const balcaoGrid = document.getElementById('balcaoGrid');
export const balcaoVazio = document.getElementById('balcaoVazio');
const contadorPedidos = document.getElementById('contadorPedidos');

// ========================================
// FILA DE PEDIDOS
// ========================================

export function renderizarPedidos() {
  contadorPedidos.textContent = estado.pedidos.length;

  if (estado.pedidos.length === 0) {
    balcaoVazio.style.display = 'block';
    balcaoGrid.innerHTML = '';
    return;
  }

  balcaoVazio.style.display = 'none';
  balcaoGrid.innerHTML = estado.pedidos.map(pedido => `
    <div class="pedido-card" data-id="${pedido.id}">
      <div>
        <div class="pedido-card__mesa">Mesa ${pedido.mesa}</div>
        ${pedido.cliente_nome ? `<div class="pedido-card__cliente">${escaparTexto(pedido.cliente_nome)}</div>` : ''}
        <div class="pedido-card__horario">${formatarHorario(pedido.criado_em)}</div>
      </div>
      ${htmlListaItens(pedido.itens)}
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

  estado.pedidos = estado.pedidos.filter(pedido => pedido.id !== id);
  renderizarPedidos();
}

balcaoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pedido-card__entregar');
  if (!botao) return;
  marcarComoEntregue(botao.dataset.id);
});
