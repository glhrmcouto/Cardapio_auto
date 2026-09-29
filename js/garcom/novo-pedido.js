import { supabase } from '../supabaseClientGarcom.js';
import { formatarPreco, escaparTexto, mostrarToast, LABEL_CATEGORIA, ORDEM_CATEGORIAS } from '../shared.js';
import { controleMesas } from './mesas.js';

const novoPedidoOverlay = document.getElementById('novoPedidoOverlay');
const novoPedidoModal = document.getElementById('novoPedidoModal');
const novoPedidoClose = document.getElementById('novoPedidoClose');
const novoPedidoMesaNumeroEl = document.getElementById('novoPedidoMesaNumero');
const novoPedidoNomeInput = document.getElementById('novoPedidoNome');
const novoPedidoItensEl = document.getElementById('novoPedidoItens');
const novoPedidoTotalEl = document.getElementById('novoPedidoTotal');
const novoPedidoLancarBtn = document.getElementById('novoPedidoLancarBtn');

// ========================================================================
// NOVO PEDIDO (lançado pelo garçom, sem QR code) — ver supabase/
// 024_lancar_pedido_garcom.sql. Botão só aparece pra papelUsuario==='garcom'
// (renderizarMesas acima); a RPC também restringe por conta própria, então
// mesmo alguém forçando a chamada via console não passa sem esse papel.
// ========================================================================

let produtosCardapio = [];   // [{id, nome, preco, categoria}] — só ativo=true
let produtosCarregados = false;
let mesaNovoPedido = null;   // número da mesa que o modal está editando agora
let carrinhoNovoPedido = {}; // { [produto_id]: quantidade }, só entradas > 0

// Cardápio é carregado uma vez só (produtos raramente mudam durante o
// serviço) e reaproveitado em toda abertura do modal depois da primeira.
// Precisa da policy produtos_select_ativos_authenticated (024) — sem ela,
// RLS devolve 0 linhas em silêncio pra qualquer authenticated sem papel
// admin.
async function garantirProdutosCarregados() {
  if (produtosCarregados) return;

  const { data, error } = await supabase
    .from('produtos')
    .select('id, nome, preco, categoria')
    .eq('ativo', true)
    .order('categoria')
    .order('ordem');

  if (error) throw error;

  produtosCardapio = data;
  produtosCarregados = true;
}

// Se a mesa estiver bloqueada, confirma com o garçom e libera ANTES de
// abrir o cardápio — ele já está vendo que tem gente sentada ali de
// verdade (é exatamente por isso que está lançando o pedido).
export async function abrirNovoPedido(mesaNumero, botao) {
  const mesa = controleMesas.mesas.find(m => String(m.numero) === String(mesaNumero));
  if (!mesa) return;

  if (mesa.status_mesa === 'bloqueada') {
    const confirmou = confirm(`Mesa ${mesaNumero} está bloqueada. Liberar e continuar com o pedido?`);
    if (!confirmou) return;

    if (botao) {
      botao.disabled = true;
      botao.textContent = 'Liberando...';
    }

    const { error } = await supabase.rpc('liberar_mesa', { p_mesa: Number(mesaNumero) });

    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Novo pedido';
    }

    if (error) {
      console.error('Erro ao liberar mesa antes do pedido:', error);
      alert('Não foi possível liberar a mesa agora. Tente de novo.');
      return;
    }

    controleMesas.atualizarLocal(mesaNumero, 'liberada');
  }

  try {
    await garantirProdutosCarregados();
  } catch (erro) {
    console.error('Erro ao carregar cardápio pro novo pedido:', erro);
    alert('Não foi possível carregar o cardápio agora. Verifique sua conexão e tente de novo.');
    return;
  }

  mesaNovoPedido = Number(mesaNumero);
  carrinhoNovoPedido = {};
  novoPedidoMesaNumeroEl.textContent = mesaNumero;
  novoPedidoNomeInput.value = '';
  renderizarProdutosNovoPedido();
  atualizarTotalNovoPedido();

  novoPedidoOverlay.classList.add('is-open');
  novoPedidoModal.classList.add('is-open');
}

function fecharNovoPedido() {
  novoPedidoOverlay.classList.remove('is-open');
  novoPedidoModal.classList.remove('is-open');
}

function renderizarLinhaProdutoNovoPedido(produto) {
  const qtd = carrinhoNovoPedido[produto.id] || 0;
  return `
    <div class="np-item">
      <div class="np-item__info">
        <span class="np-item__nome">${escaparTexto(produto.nome)}</span>
        <span class="np-item__preco">${formatarPreco(produto.preco)}</span>
      </div>
      <div class="np-item__qtd">
        <button type="button" class="np-item__botao" data-acao="menos" data-produto="${produto.id}" ${qtd === 0 ? 'disabled' : ''}>−</button>
        <span class="np-item__valor" data-qtd-produto="${produto.id}">${qtd}</span>
        <button type="button" class="np-item__botao" data-acao="mais" data-produto="${produto.id}">+</button>
      </div>
    </div>
  `;
}

function renderizarProdutosNovoPedido() {
  const grupos = {};
  ORDEM_CATEGORIAS.forEach(categoria => { grupos[categoria] = []; });
  produtosCardapio.forEach(produto => {
    if (!grupos[produto.categoria]) grupos[produto.categoria] = [];
    grupos[produto.categoria].push(produto);
  });

  novoPedidoItensEl.innerHTML = ORDEM_CATEGORIAS
    .filter(categoria => grupos[categoria] && grupos[categoria].length > 0)
    .map(categoria => `
      <div class="np-categoria">
        <h3 class="np-categoria__titulo">${LABEL_CATEGORIA[categoria] || categoria}</h3>
        ${grupos[categoria].map(renderizarLinhaProdutoNovoPedido).join('')}
      </div>
    `).join('');
}

// Atualiza só o número (não redesenha a lista toda) — mantém o scroll e a
// posição do dedo do garçom estáveis enquanto ele toca +/- várias vezes.
function alterarQuantidadeNovoPedido(produtoId, delta) {
  const atual = carrinhoNovoPedido[produtoId] || 0;
  const novo = Math.max(0, Math.min(50, atual + delta));

  if (novo === 0) delete carrinhoNovoPedido[produtoId];
  else carrinhoNovoPedido[produtoId] = novo;

  const valorEl = novoPedidoItensEl.querySelector(`[data-qtd-produto="${produtoId}"]`);
  if (valorEl) valorEl.textContent = novo;

  const botaoMenos = novoPedidoItensEl.querySelector(`.np-item__botao[data-acao="menos"][data-produto="${produtoId}"]`);
  if (botaoMenos) botaoMenos.disabled = novo === 0;

  atualizarTotalNovoPedido();
}

function atualizarTotalNovoPedido() {
  let total = 0;
  let totalItens = 0;

  for (const [produtoId, quantidade] of Object.entries(carrinhoNovoPedido)) {
    const produto = produtosCardapio.find(p => String(p.id) === produtoId);
    if (produto) total += produto.preco * quantidade;
    totalItens += quantidade;
  }

  novoPedidoTotalEl.textContent = formatarPreco(total);
  novoPedidoLancarBtn.disabled = totalItens === 0;
}

novoPedidoItensEl.addEventListener('click', (event) => {
  const botao = event.target.closest('.np-item__botao');
  if (!botao) return;
  const produtoId = Number(botao.dataset.produto);
  const delta = botao.dataset.acao === 'mais' ? 1 : -1;
  alterarQuantidadeNovoPedido(produtoId, delta);
});

// Preço sempre recalculado no banco (lancar_pedido_garcom lê produtos.preco
// de novo) — o total mostrado aqui é só pra conferência do garçom antes de
// confirmar, nunca é o que de fato grava.
async function lancarNovoPedido() {
  const itens = Object.entries(carrinhoNovoPedido).map(([produtoId, quantidade]) => ({
    produto_id: Number(produtoId),
    quantidade,
  }));

  if (itens.length === 0) return;

  novoPedidoLancarBtn.disabled = true;
  novoPedidoLancarBtn.textContent = 'Lançando...';

  const { error } = await supabase.rpc('lancar_pedido_garcom', {
    p_mesa: mesaNovoPedido,
    p_itens: itens,
    p_cliente_nome: novoPedidoNomeInput.value.trim() || null,
  });

  novoPedidoLancarBtn.disabled = false;
  novoPedidoLancarBtn.textContent = 'Lançar pedido';

  if (error) {
    console.error('Erro ao lançar pedido:', error);
    if (error.details === 'MESA_BLOQUEADA') {
      alert('A mesa foi bloqueada de novo antes do pedido ser lançado (talvez por um fechamento em outro aparelho). Feche, libere a mesa de novo e tente lançar o pedido.');
    } else {
      alert(error.message || 'Não foi possível lançar o pedido agora. Verifique sua conexão e tente de novo.');
    }
    return;
  }

  fecharNovoPedido();
  mostrarToast('Pedido lançado!');
  // Não precisa empurrar o pedido novo na lista manualmente: o Realtime de
  // "pedidos" (já assinado, ver inscreverRealtime) traz ele sozinho pra
  // aba Pedidos, do mesmo jeito que traria um pedido feito pelo cliente.
}

novoPedidoLancarBtn.addEventListener('click', lancarNovoPedido);
novoPedidoClose.addEventListener('click', fecharNovoPedido);
novoPedidoOverlay.addEventListener('click', fecharNovoPedido);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && novoPedidoModal.classList.contains('is-open')) {
    fecharNovoPedido();
  }
});

