import { supabase } from './supabaseClient.js';

// ========================================
// FORMATAÇÃO
// ========================================

// Formata número em Real brasileiro
function formatarPreco(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ========================================
// CARREGAMENTO DO CARDÁPIO (Supabase)
// ========================================
//
// O cardápio não é mais fixo no JS: vem da tabela "produtos" (ver
// supabase/001_schema.sql). O RLS só deixa o cliente (anon) ler produtos
// com ativo = true, então essa consulta já vem filtrada pelo próprio banco.

const cardapioCarregandoEl = document.getElementById('cardapioCarregando');
const cardapioErroEl = document.getElementById('cardapioErro');
const cardapioTentarBtn = document.getElementById('cardapioTentar');

const GRID_POR_CATEGORIA = {
  drink: 'drinks-grid',
  cerveja: 'cervejas-grid',
  sem_alcool: 'semAlcool-grid',
  narguile: 'narguile-grid',
};

// Cria o HTML de um card de bebida/narguilé e injeta no container
// (data-produto-id no botão é o que a RPC criar_pedido recebe; data-nome/data-preco
// só alimentam a exibição do carrinho — o preço real é sempre recalculado no banco)
function renderizarCardsBebida(lista, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = lista.map(item => `
    <div class="card fade-in">
      <div class="card__header">
        <span class="card__name">${item.nome}</span>
        <span class="card__price">${formatarPreco(item.preco)}</span>
      </div>
      <p class="card__desc">${item.descricao}</p>
      <button class="btn btn--add" data-produto-id="${item.id}" data-nome="${item.nome}" data-preco="${item.preco}">Adicionar</button>
    </div>
  `).join('');
}

// Cria o HTML de um card de essência e injeta no container
// Essências não têm preço próprio no cardápio (o custo já está no narguilé),
// então entram no carrinho com preço 0 — servem só pra registrar a escolha do cliente.
function renderizarCardsEssencia(lista, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = lista.map(item => `
    <div class="essencia-card fade-in">
      <p class="essencia-card__name">${item.nome}</p>
      <span class="essencia-card__tag">${item.descricao}</span>
      <button class="btn btn--add essencia-card__add" data-produto-id="${item.id}" data-nome="${item.nome}" data-preco="0">Adicionar</button>
    </div>
  `).join('');
}

function agruparPorCategoria(produtos) {
  const grupos = { drink: [], cerveja: [], sem_alcool: [], narguile: [], essencia: [] };
  produtos.forEach(produto => {
    if (grupos[produto.categoria]) grupos[produto.categoria].push(produto);
  });
  return grupos;
}

function renderizarTodoCardapio(produtos) {
  const grupos = agruparPorCategoria(produtos);

  Object.entries(GRID_POR_CATEGORIA).forEach(([categoria, gridId]) => {
    renderizarCardsBebida(grupos[categoria], gridId);
  });
  renderizarCardsEssencia(grupos.essencia, 'essencias-grid');

  observarFadeIns();
}

// Busca o cardápio no Supabase; mostra "carregando" e, se falhar, um erro
// amigável com botão pra tentar de novo (sem precisar recarregar a página toda)
async function carregarCardapio() {
  cardapioCarregandoEl.style.display = 'block';
  cardapioErroEl.style.display = 'none';

  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('id, nome, descricao, preco, categoria')
      .eq('ativo', true)
      .order('ordem');

    if (error) throw error;

    renderizarTodoCardapio(data);
    cardapioCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar cardápio:', erro);
    cardapioCarregandoEl.style.display = 'none';
    cardapioErroEl.style.display = 'block';
  }
}

cardapioTentarBtn.addEventListener('click', carregarCardapio);
carregarCardapio();

// ========================================
// ANIMAÇÃO FADE-IN AO ROLAR (IntersectionObserver)
// ========================================

// Observa todos os elementos .fade-in e adiciona .is-visible quando entram na tela
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.15,
});

// Os elementos estáticos (títulos, textos) já existem no HTML desde o início;
// os cards são criados depois, de forma assíncrona, então essa função é chamada
// de novo (de propósito) sempre que o cardápio é (re)renderizado.
function observarFadeIns() {
  document.querySelectorAll('.fade-in').forEach(el => {
    if (!el.classList.contains('is-visible')) observer.observe(el);
  });
}

observarFadeIns();

// ========================================
// CARRINHO E ENVIO DE PEDIDOS
// ========================================
//
// O carrinho guarda produtoId + quantidade; nome/preço aqui são só pra exibição
// (o preço que vale de verdade é recalculado dentro da RPC criar_pedido, no banco,
// então mesmo que alguém adultere esses valores no navegador, o pedido grava certo).
//
// Pedido e fechamento de conta não passam mais por BroadcastChannel/localStorage:
// vão direto pro Supabase (RPCs criar_pedido / pedir_fechamento) e a tela do
// balcão os recebe por ali (leitura + Realtime), então funciona entre aparelhos
// diferentes (celular do cliente + PC do balcão).

let carrinho = []; // cada item: { produtoId, nome, preco, quantidade }

const mesaInput = document.getElementById('mesaInput');
const mesaAviso = document.getElementById('mesaAviso');

// Se a página abrir com ?mesa=5 na URL (QR code na mesa), pré-preenche o campo e
// TRANCA ele (readonly) — o cliente não deve poder trocar de mesa manualmente
// quando ela já veio do QR code físico da própria mesa.
const mesaDaUrl = new URLSearchParams(window.location.search).get('mesa');
if (mesaDaUrl) {
  mesaInput.value = mesaDaUrl;
  mesaInput.readOnly = true;
}

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
const toastEl = document.getElementById('toast');

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

// Adiciona um item ao carrinho, ou soma +1 na quantidade se ele já estiver lá
function adicionarAoCarrinho(produtoId, nome, preco) {
  const existente = carrinho.find(item => item.produtoId === produtoId);
  if (existente) {
    existente.quantidade++;
  } else {
    carrinho.push({ produtoId, nome, preco, quantidade: 1 });
  }
  renderizarCarrinho();
  abrirCarrinho();
}

// Soma/subtrai quantidade de um item; remove do carrinho se chegar a 0
function alterarQuantidade(produtoId, delta) {
  const item = carrinho.find(i => i.produtoId === produtoId);
  if (!item) return;
  item.quantidade += delta;
  if (item.quantidade <= 0) {
    carrinho = carrinho.filter(i => i.produtoId !== produtoId);
  }
  renderizarCarrinho();
}

function removerDoCarrinho(produtoId) {
  carrinho = carrinho.filter(i => i.produtoId !== produtoId);
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
          <span class="cart-item__nome">${item.nome}</span>
          <span class="cart-item__preco">${formatarPreco(item.preco)}</span>
        </div>
        <div class="cart-item__controles">
          <button class="cart-item__btn" data-acao="menos" data-produto-id="${item.produtoId}" aria-label="Diminuir quantidade">-</button>
          <span class="cart-item__qtd">${item.quantidade}</span>
          <button class="cart-item__btn" data-acao="mais" data-produto-id="${item.produtoId}" aria-label="Aumentar quantidade">+</button>
          <button class="cart-item__remover" data-acao="remover" data-produto-id="${item.produtoId}" aria-label="Remover item">🗑</button>
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
  const { acao } = botao.dataset;
  if (acao === 'mais') alterarQuantidade(produtoId, 1);
  if (acao === 'menos') alterarQuantidade(produtoId, -1);
  if (acao === 'remover') removerDoCarrinho(produtoId);
});

// Delegação de eventos: cobre os botões "Adicionar" de todos os cards (já existentes e futuros)
document.addEventListener('click', (event) => {
  const botao = event.target.closest('.btn--add');
  if (!botao) return;
  adicionarAoCarrinho(Number(botao.dataset.produtoId), botao.dataset.nome, parseFloat(botao.dataset.preco));
});

// Mostra uma mensagem rápida no rodapé da tela
function mostrarToast(mensagem) {
  toastEl.textContent = mensagem;
  toastEl.classList.add('show');
  clearTimeout(mostrarToast._timer);
  mostrarToast._timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// Valida a mesa, chama a RPC criar_pedido (o preço real é recalculado no banco) e,
// se der certo, limpa o carrinho. Em erro de rede/servidor, avisa e mantém o carrinho
// intacto pro cliente poder tentar de novo sem perder o que já tinha escolhido.
async function fazerPedido() {
  const mesaValor = mesaInput.value.trim();

  if (!mesaValor) {
    mesaAviso.classList.add('show');
    mesaInput.focus();
    mesaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  mesaAviso.classList.remove('show');

  if (carrinho.length === 0) {
    mostrarToast('Adicione pelo menos um item antes de fazer o pedido.');
    return;
  }

  const itensPayload = carrinho.map(item => ({
    produto_id: item.produtoId,
    quantidade: item.quantidade,
  }));

  cartSubmit.disabled = true;
  cartSubmit.textContent = 'Enviando...';

  try {
    const { error } = await supabase.rpc('criar_pedido', {
      p_mesa: Number(mesaValor),
      p_itens: itensPayload,
    });

    if (error) throw error;

    mostrarToast('Pedido enviado! O garçom já foi avisado.');
    carrinho = [];
    renderizarCarrinho();
    fecharCarrinho();
  } catch (erro) {
    console.error('Erro ao enviar pedido:', erro);
    mostrarToast('O pedido NÃO foi enviado. Verifique sua conexão e tente de novo.');
    // Carrinho é mantido de propósito — o cliente não perde o que já tinha escolhido.
  } finally {
    cartSubmit.disabled = false;
    cartSubmit.textContent = cartSubmitTextoOriginal;
  }
}

cartSubmit.addEventListener('click', fazerPedido);

mesaInput.addEventListener('input', () => {
  if (mesaInput.value.trim()) mesaAviso.classList.remove('show');
});

// ========================================
// FECHAR CONTA
// ========================================

const fecharContaBtn = document.getElementById('fecharContaBtn');
const fecharContaOverlay = document.getElementById('fecharContaOverlay');
const fecharContaModal = document.getElementById('fecharContaModal');
const fecharContaMesaEl = document.getElementById('fecharContaMesa');
const fecharContaItensEl = document.getElementById('fecharContaItens');
const fecharContaVazioEl = document.getElementById('fecharContaVazio');
const fecharContaTotalEl = document.getElementById('fecharContaTotal');
const fecharContaClose = document.getElementById('fecharContaClose');
const fecharContaCancelar = document.getElementById('fecharContaCancelar');
const fecharContaConfirmar = document.getElementById('fecharContaConfirmar');

// Abre o modal na hora (com "consultando...") e preenche assim que a RPC conta_da_mesa
// responder. Ela já ignora pedidos "finalizado", então uma mesa reaproveitada não
// arrasta o consumo de um cliente anterior.
async function abrirModalFecharConta(mesa) {
  fecharContaMesaEl.textContent = mesa;
  fecharContaItensEl.innerHTML = '';
  fecharContaVazioEl.textContent = 'Consultando conta...';
  fecharContaVazioEl.style.display = 'block';
  fecharContaTotalEl.textContent = formatarPreco(0);

  fecharContaOverlay.classList.add('is-open');
  fecharContaModal.classList.add('is-open');

  try {
    const { data: conta, error } = await supabase.rpc('conta_da_mesa', { p_mesa: Number(mesa) });

    if (error) throw error;

    if (!conta.itens || conta.itens.length === 0) {
      fecharContaVazioEl.textContent = 'Nenhum pedido registrado para essa mesa.';
      fecharContaVazioEl.style.display = 'block';
    } else {
      fecharContaVazioEl.style.display = 'none';
      fecharContaItensEl.innerHTML = conta.itens.map(item => `
        <li class="modal-panel__item">
          <span>${item.quantidade}x ${item.nome}</span>
          <span>${formatarPreco(item.preco * item.quantidade)}</span>
        </li>
      `).join('');
    }

    fecharContaTotalEl.textContent = formatarPreco(conta.total);
  } catch (erro) {
    console.error('Erro ao consultar conta da mesa:', erro);
    fecharContaItensEl.innerHTML = '';
    fecharContaVazioEl.textContent = 'Não foi possível consultar a conta agora. Verifique sua conexão e tente de novo.';
    fecharContaVazioEl.style.display = 'block';
  }
}

function fecharModalFecharConta() {
  fecharContaOverlay.classList.remove('is-open');
  fecharContaModal.classList.remove('is-open');
}

function fecharConta() {
  const mesa = mesaInput.value.trim();

  if (!mesa) {
    mesaAviso.classList.add('show');
    mesaInput.focus();
    mesaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  mesaAviso.classList.remove('show');

  abrirModalFecharConta(mesa);
}

// Só dispara o pedido de fechamento depois que o cliente confirma no modal.
// pedir_fechamento evita duplicar: se já existir um fechamento pendente pra essa
// mesa, o banco devolve o mesmo registro em vez de criar um novo alerta no balcão.
async function confirmarFecharConta() {
  const mesa = mesaInput.value.trim();

  fecharContaConfirmar.disabled = true;

  try {
    const { error } = await supabase.rpc('pedir_fechamento', { p_mesa: Number(mesa) });

    if (error) throw error;

    fecharModalFecharConta();
    mostrarToast('Pedido de fechamento enviado! O garçom já foi avisado.');
  } catch (erro) {
    console.error('Erro ao pedir fechamento:', erro);
    mostrarToast('Não foi possível enviar o pedido de fechamento. Verifique sua conexão e tente de novo.');
  } finally {
    fecharContaConfirmar.disabled = false;
  }
}

fecharContaBtn.addEventListener('click', fecharConta);
fecharContaClose.addEventListener('click', fecharModalFecharConta);
fecharContaCancelar.addEventListener('click', fecharModalFecharConta);
fecharContaOverlay.addEventListener('click', fecharModalFecharConta);
fecharContaConfirmar.addEventListener('click', confirmarFecharConta);

renderizarCarrinho();
