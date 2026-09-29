import { supabase } from '../supabaseClient.js';
import { formatarPreco, escaparTexto } from '../shared.js';
import { estado } from './estado.js';
import { formatarHorario } from './conta.js';
import { pedirConfirmacaoSenha } from './senha.js';
import { renderizarMesasAtivas } from './mesas-ativas.js';

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

  const pedido = estado.pedidos.find(p => p.id === pedidoId);
  if (pedido) {
    pedido.itens = pedido.itens.filter(item => String(item.id) !== String(itemId));
    if (pedido.itens.length === 0) {
      estado.pedidos = estado.pedidos.filter(p => p.id !== pedidoId);
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

  estado.pedidos = estado.pedidos.filter(pedido => pedido.id !== id);
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
