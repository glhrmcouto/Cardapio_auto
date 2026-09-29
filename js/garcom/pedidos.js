import { supabase } from '../supabaseClientGarcom.js';
import { formatarPreco, escaparTexto } from '../shared.js';
import { estado } from './estado.js';

const pedidosCarregandoEl = document.getElementById('pedidosCarregando');
const pedidosErroEl = document.getElementById('pedidosErro');
const pedidosTentarBtn = document.getElementById('pedidosTentar');
const pedidosVazioEl = document.getElementById('pedidosVazio');
const pedidosGrid = document.getElementById('pedidosGrid');
const pedidosBadgeEl = document.getElementById('pedidosBadge');

// ========================================================================
// ABA PEDIDOS — fila de pedidos pendentes (reaproveita a MESMA consulta e
// o MESMO "marcar entregue" de js/balcao.js — nenhuma RPC nova; entregar é
// só um UPDATE em "pedidos" via RLS pedidos_update_authenticated). Sem o
// botão de remover item (fica só no balcão) — versão enxuta pro celular.
// ========================================================================


export function ordenarPedidosGarcom() {
  estado.pedidosGarcom.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
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
  estado.pedidosGarcom = data;
}

export async function carregarPedidosIniciais() {
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
  const qtd = estado.pedidosGarcom.length;
  pedidosBadgeEl.textContent = qtd;
  pedidosBadgeEl.hidden = qtd === 0;
}

// Mesmo componente visual .pedido-card de balcao.css — mesa, cliente,
// horário, status, itens e total; sem o botão de remover item.
export function renderizarPedidos() {
  atualizarBadgePedidos();

  if (estado.pedidosGarcom.length === 0) {
    pedidosVazioEl.style.display = 'block';
    pedidosGrid.innerHTML = '';
    return;
  }

  pedidosVazioEl.style.display = 'none';
  pedidosGrid.innerHTML = estado.pedidosGarcom.map(pedido => `
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

  estado.pedidosGarcom = estado.pedidosGarcom.filter(pedido => pedido.id !== id);
  renderizarPedidos();
}

pedidosGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pedido-card__entregar');
  if (!botao) return;
  marcarEntregue(botao.dataset.id, botao);
});

