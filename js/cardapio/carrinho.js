import { supabase } from '../supabaseClient.js';
import { formatarPreco, mostrarToast } from '../shared.js';
import { exigirMesa, tokenMesa, sessaoId, salvarSessao, mostrarContaEncerrada, ehErroSessaoEncerrada } from './mesa.js';
import { clienteId, clienteNome, abrirModalNome } from './cliente.js';

// ========================================
// CARRINHO E ENVIO DE PEDIDOS
// ========================================
//
// O carrinho guarda produtoId + quantidade; nome/preço aqui são só pra exibição
// (o preço que vale de verdade é recalculado dentro da RPC criar_pedido, no banco,
// então mesmo que alguém adultere esses valores no navegador, o pedido grava certo).
//
// Pedido e fechamento de conta vão direto pro Supabase (RPCs criar_pedido /
// pedir_fechamento) e a tela do balcão os recebe por ali (leitura + Realtime),
// então funciona entre aparelhos diferentes (celular do cliente + PC do balcão).

let carrinho = []; // cada item: { produtoId, nome, preco, quantidade }

const cartFab = document.getElementById('cartFab');
const cartBadge = document.getElementById('cartBadge');
const cartPanel = document.getElementById('cartPanel');
const cartOverlay = document.getElementById('cartOverlay');
const cartClose = document.getElementById('cartClose');
const cartItemsEl = document.getElementById('cartItems');
const cartEmptyEl = document.getElementById('cartEmpty');
const cartTotalEl = document.getElementById('cartTotal');
const cartSubmit = document.getElementById('cartSubmit');
const cartSubmitTextoOriginal = cartSubmit.textContent;

function abrirCarrinho() {
  cartPanel.classList.add('is-open');
  cartOverlay.classList.add('is-open');
}

function fecharCarrinho() {
  cartPanel.classList.remove('is-open');
  cartOverlay.classList.remove('is-open');
}

cartFab.addEventListener('click', abrirCarrinho);
cartClose.addEventListener('click', fecharCarrinho);
cartOverlay.addEventListener('click', fecharCarrinho);

// Adiciona um item ao carrinho, ou soma +1 na quantidade se ele já estiver lá com o
// MESMO estado de "compartilhado" — um narguilé normal e um narguilé "pra dividir"
// contam como linhas separadas no carrinho, já que vão gerar rateios diferentes.
function adicionarAoCarrinho(produtoId, nome, preco, compartilhado = false) {
  const existente = carrinho.find(item => item.produtoId === produtoId && item.compartilhado === compartilhado);
  if (existente) {
    existente.quantidade++;
  } else {
    carrinho.push({ produtoId, nome, preco, quantidade: 1, compartilhado });
  }
  renderizarCarrinho();
  abrirCarrinho();
}

// Soma/subtrai quantidade de um item; remove do carrinho se chegar a 0
function alterarQuantidade(produtoId, compartilhado, delta) {
  const item = carrinho.find(i => i.produtoId === produtoId && i.compartilhado === compartilhado);
  if (!item) return;
  item.quantidade += delta;
  if (item.quantidade <= 0) {
    carrinho = carrinho.filter(i => !(i.produtoId === produtoId && i.compartilhado === compartilhado));
  }
  renderizarCarrinho();
}

function removerDoCarrinho(produtoId, compartilhado) {
  carrinho = carrinho.filter(i => !(i.produtoId === produtoId && i.compartilhado === compartilhado));
  renderizarCarrinho();
}

function calcularTotalCarrinho() {
  return carrinho.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
}

// Redesenha a lista de itens, o total e o badge de quantidade do carrinho
function renderizarCarrinho() {
  const totalItens = carrinho.reduce((soma, item) => soma + item.quantidade, 0);
  cartBadge.textContent = totalItens;

  if (carrinho.length === 0) {
    cartEmptyEl.style.display = 'block';
    cartItemsEl.innerHTML = '';
  } else {
    cartEmptyEl.style.display = 'none';
    cartItemsEl.innerHTML = carrinho.map(item => `
      <div class="cart-item">
        <div class="cart-item__info">
          <span class="cart-item__nome">${item.nome}${item.compartilhado ? '<span class="cart-item__tag">Dividido</span>' : ''}</span>
          <span class="cart-item__preco">${formatarPreco(item.preco)}</span>
        </div>
        <div class="cart-item__controles">
          <button class="cart-item__btn" data-acao="menos" data-produto-id="${item.produtoId}" data-compartilhado="${item.compartilhado}" aria-label="Diminuir quantidade">-</button>
          <span class="cart-item__qtd">${item.quantidade}</span>
          <button class="cart-item__btn" data-acao="mais" data-produto-id="${item.produtoId}" data-compartilhado="${item.compartilhado}" aria-label="Aumentar quantidade">+</button>
          <button class="cart-item__remover" data-acao="remover" data-produto-id="${item.produtoId}" data-compartilhado="${item.compartilhado}" aria-label="Remover item">🗑</button>
        </div>
      </div>
    `).join('');
  }

  cartTotalEl.textContent = formatarPreco(calcularTotalCarrinho());
}

// Delegação de eventos: um único listener cuida de +, - e remover de qualquer item
cartItemsEl.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-acao]');
  if (!botao) return;
  const produtoId = Number(botao.dataset.produtoId);
  const compartilhado = botao.dataset.compartilhado === 'true';
  const { acao } = botao.dataset;
  if (acao === 'mais') alterarQuantidade(produtoId, compartilhado, 1);
  if (acao === 'menos') alterarQuantidade(produtoId, compartilhado, -1);
  if (acao === 'remover') removerDoCarrinho(produtoId, compartilhado);
});

// Delegação de eventos: cobre os botões "Adicionar" de todos os cards (já existentes e futuros).
// O checkbox "Dividir entre a mesa" (só existe nos cards de narguilé) é lido aqui, na hora
// do clique — se o card não tiver o checkbox (bebida comum), compartilhado fica false.
document.addEventListener('click', (event) => {
  const botao = event.target.closest('.btn--add');
  if (!botao) return;
  const checkbox = botao.closest('.card')?.querySelector('.card__compartilhado-check');
  const compartilhado = checkbox ? checkbox.checked : false;
  adicionarAoCarrinho(Number(botao.dataset.produtoId), botao.dataset.nome, parseFloat(botao.dataset.preco), compartilhado);
});

// ========================================
// CONFIRMAÇÃO CENTRAL DE PEDIDO ENVIADO
// ========================================
//
// Diferente do toast de rodapé (mostrarToast, em shared.js): "Pedido enviado" pedia
// destaque forte, então sobe centralizada, com fundo escurecido atrás — ver
// .pedido-confirmado-overlay em css/style.css. Some sozinha depois de
// alguns segundos ou ao toque em qualquer lugar do overlay.

const pedidoConfirmadoOverlay = document.getElementById('pedidoConfirmadoOverlay');

function esconderPedidoConfirmado() {
  pedidoConfirmadoOverlay.classList.remove('show');
  clearTimeout(mostrarPedidoConfirmado._timer);
}

function mostrarPedidoConfirmado() {
  pedidoConfirmadoOverlay.classList.add('show');
  clearTimeout(mostrarPedidoConfirmado._timer);
  mostrarPedidoConfirmado._timer = setTimeout(esconderPedidoConfirmado, 2800);
}

pedidoConfirmadoOverlay.addEventListener('click', esconderPedidoConfirmado);

// Valida a mesa, chama a RPC criar_pedido (o preço real é recalculado no banco) e,
// se der certo, limpa o carrinho. Em erro de rede/servidor, avisa e mantém o carrinho
// intacto pro cliente poder tentar de novo sem perder o que já tinha escolhido.
async function fazerPedido() {
  const mesaValor = exigirMesa();
  if (!mesaValor) return;

  if (carrinho.length === 0) {
    mostrarToast('Adicione pelo menos um item antes de fazer o pedido.');
    return;
  }

  // Nome é obrigatório pro pedido (ver supabase/008_sessoes.sql) — se por algum
  // motivo a pessoa chegou até aqui sem ter preenchido (ex.: fechou o modal no
  // dev tools), reabre o modal em vez de deixar a RPC recusar sem explicação.
  if (!clienteNome) {
    abrirModalNome();
    mostrarToast('Informe seu nome antes de fazer o pedido.');
    return;
  }

  const itensPayload = carrinho.map(item => ({
    produto_id: item.produtoId,
    quantidade: item.quantidade,
    compartilhado: item.compartilhado,
  }));

  cartSubmit.disabled = true;
  cartSubmit.textContent = 'Enviando...';

  try {
    const { data, error } = await supabase.rpc('criar_pedido', {
      p_mesa: Number(mesaValor),
      p_token: tokenMesa,
      p_itens: itensPayload,
      p_cliente_nome: clienteNome,
      p_cliente_id: clienteId,
      p_session_id: sessaoId,
    });

    if (error) throw error;

    // Guarda o session_id que o servidor efetivamente usou (abriu uma sessão
    // nova agora, ou confirmou a que já tínhamos) — os próximos pedidos desta
    // visita passam a usar esse mesmo id (ver supabase/014_sessao_vinculada.sql).
    salvarSessao(data.sessao_id);

    fecharCarrinho();
    mostrarPedidoConfirmado();
    carrinho = [];
    renderizarCarrinho();
  } catch (erro) {
    console.error('Erro ao enviar pedido:', erro);

    if (ehErroSessaoEncerrada(erro)) {
      // Trava a tela de vez — não existe mais reenvio nem reabertura de
      // sessão pela própria página (ver comentário no topo da seção
      // "BLOQUEIO DE ACESSO + VÍNCULO DE SESSÃO"). O carrinho fica como
      // está; a única saída daqui é re-escanear o QR físico da mesa.
      mostrarContaEncerrada();
      return;
    }

    // erro.message vem da RPC (ver supabase/005_seguranca.sql) e já foi escrito
    // pra ser seguro de mostrar — nunca revela SE foi mesa errada, token errado
    // ou mesa desativada, só que "algo não bateu". Cai no texto genérico só se
    // vier um erro sem mensagem (rede fora do ar, por exemplo).
    mostrarToast(erro.message || 'O pedido NÃO foi enviado. Verifique sua conexão e tente de novo.');
    // Carrinho é mantido de propósito — o cliente não perde o que já tinha escolhido.
  } finally {
    cartSubmit.disabled = false;
    cartSubmit.textContent = cartSubmitTextoOriginal;
  }
}

cartSubmit.addEventListener('click', fazerPedido);

renderizarCarrinho();
