// ========================================
// DADOS DO CARDÁPIO
// ========================================

const drinks = [
  { nome: 'Caipirinha', desc: 'Cachaça, limão fresco, açúcar e gelo na medida certa.', preco: 18, /* imagem: 'img/Caipirinha.jpg' */ },
  { nome: 'Moscow Mule', desc: 'Vodka, gengibre, limão e ginger beer geladinha.', preco: 24 },
  { nome: 'Gin Tônica', desc: 'Gin premium, tônica artesanal e toque cítrico.', preco: 26 },
  { nome: 'Aperol Spritz', desc: 'Aperol, espumante e um splash de água com gás.', preco: 28 },
  { nome: 'Negroni', desc: 'Gin, vermute rosso e Campari em partes iguais.', preco: 27 },
  { nome: 'Mojito', desc: 'Rum, hortelã fresca, limão, açúcar e água com gás.', preco: 25 },
  { nome: 'Piña Colada', desc: 'Rum, leite de coco e abacaxi batido com gelo.', preco: 26 },
  { nome: 'Sex on the Beach', desc: 'Vodka, licor de pêssego, suco de laranja e cranberry.', preco: 24 },
];

const cervejas = [
  { nome: 'Heineken Long Neck', desc: 'Lager holandesa, leve e refrescante.', preco: 13 },
  { nome: 'Original 600ml', desc: 'Pilsen puro malte, clássica pra dividir com a galera.', preco: 18 },
  { nome: 'Brahma Duplo Malte', desc: 'Encorpada e cremosa, fácil de tomar.', preco: 10 },
  { nome: 'Budweiser Long Neck', desc: 'Lager americana, suave e refrescante.', preco: 11 },
  { nome: 'Colorado Indica IPA', desc: 'IPA brasileira com mel, lupulada e amarga.', preco: 22 },
  { nome: 'Eisenbahn Weizenbier', desc: 'Weiss brasileira, turva com notas de banana e cravo.', preco: 16 },
];

const narguile = [
  { nome: 'Narguilé Completo', desc: 'Montagem completa com essência à sua escolha.', preco: 45 },
  { nome: 'Troca de Rosh', desc: 'Rosh novo com essência renovada.', preco: 20 },
  { nome: 'Carvão Extra', desc: 'Porção adicional de carvão natural.', preco: 8 },
  { nome: 'Essência Dupla', desc: 'Mescla de duas essências no mesmo narguilé.', preco: 10 },
];

const semAlcool = [
  { nome: 'Refrigerante Lata', desc: 'Coca, Guaraná, Fanta ou Sprite gelados.', preco: 7 },
  { nome: 'Suco Natural', desc: 'Feito na hora: laranja, abacaxi ou maracujá.', preco: 12 },
  { nome: 'Água Mineral', desc: 'Com ou sem gás, 500ml gelada.', preco: 5 },
  { nome: 'Energético', desc: 'Lata gelada, ideal pra acompanhar o narguilé.', preco: 15 },
]


const essencias = [
  { nome: 'Menta Ice', tag: 'Refrescante' },
  { nome: 'Melancia', tag: 'Doce' },
  { nome: 'Uva', tag: 'Frutado' },
  { nome: 'Frutas Vermelhas', tag: 'Frutado' },
  { nome: 'Blueberry', tag: 'Doce' },
  { nome: 'Maçã Verde', tag: 'Cítrico' },
  { nome: 'Limão Gelado', tag: 'Cítrico' },
  { nome: 'Duplo Menta', tag: 'Refrescante' },
  { nome: 'Abacaxi', tag: 'Tropical' },
  { nome: 'Tutti-Frutti', tag: 'Doce' },
];

// ========================================
// RENDERIZAÇÃO DOS CARDS
// ========================================

// Formata número em Real brasileiro
function formatarPreco(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Cria o HTML de um card de bebida/narguilé e injeta no container
// (data-nome/data-preco no botão são lidos pelo carrinho na seção de pedidos, mais abaixo)
// <img class="card__img" src="${item.imagem}" alt="${item.nome}" loading="lazy">
function renderizarCardsBebida(lista, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = lista.map(item => `
    <div class="card fade-in">
      <div class="card__header">     
        <span class="card__name">${item.nome}</span>
        <span class="card__price">${formatarPreco(item.preco)}</span>
      </div>
      <p class="card__desc">${item.desc}</p>
      <button class="btn btn--add" data-nome="${item.nome}" data-preco="${item.preco}">Adicionar</button>
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
      <span class="essencia-card__tag">${item.tag}</span>
      <button class="btn btn--add essencia-card__add" data-nome="${item.nome}" data-preco="0">Adicionar</button>
    </div>
  `).join('');
}

renderizarCardsBebida(drinks, 'drinks-grid');
renderizarCardsBebida(cervejas, 'cervejas-grid');
renderizarCardsBebida(narguile, 'narguile-grid');
renderizarCardsBebida(semAlcool, 'semAlcool-grid');
renderizarCardsEssencia(essencias, 'essencias-grid');

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

// Os cards são criados dinamicamente, então observamos depois da renderização
document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// ========================================
// CARRINHO E ENVIO DE PEDIDOS
// ========================================
//
// Hoje o pedido "viaja" do cardápio até o balcão via BroadcastChannel do navegador
// (só funciona entre abas/telas do MESMO dispositivo) + localStorage (pra sobreviver
// a um reload da tela do balcão). Se um dia o cardápio for aberto no celular do
// cliente e o balcão ficar em outro aparelho, essa camada precisa virar algo em
// tempo real de verdade — Firebase Realtime Database/Firestore ou Supabase Realtime
// são boas opções, mantendo a mesma estrutura do objeto "pedido" usada aqui embaixo.
const canalPedidos = new BroadcastChannel('aooba_pedidos');

let carrinho = []; // cada item: { nome, preco, quantidade }

const mesaInput = document.getElementById('mesaInput');
const mesaAviso = document.getElementById('mesaAviso');

const cartFab = document.getElementById('cartFab');
const cartBadge = document.getElementById('cartBadge');
const cartPanel = document.getElementById('cartPanel');
const cartOverlay = document.getElementById('cartOverlay');
const cartClose = document.getElementById('cartClose');
const cartItemsEl = document.getElementById('cartItems');
const cartEmptyEl = document.getElementById('cartEmpty');
const cartTotalEl = document.getElementById('cartTotal');
const cartSubmit = document.getElementById('cartSubmit');
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
function adicionarAoCarrinho(nome, preco) {
  const existente = carrinho.find(item => item.nome === nome);
  if (existente) {
    existente.quantidade++;
  } else {
    carrinho.push({ nome, preco, quantidade: 1 });
  }
  renderizarCarrinho();
  abrirCarrinho();
}

// Soma/subtrai quantidade de um item; remove do carrinho se chegar a 0
function alterarQuantidade(nome, delta) {
  const item = carrinho.find(i => i.nome === nome);
  if (!item) return;
  item.quantidade += delta;
  if (item.quantidade <= 0) {
    carrinho = carrinho.filter(i => i.nome !== nome);
  }
  renderizarCarrinho();
}

function removerDoCarrinho(nome) {
  carrinho = carrinho.filter(i => i.nome !== nome);
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
          <button class="cart-item__btn" data-acao="menos" data-nome="${item.nome}" aria-label="Diminuir quantidade">-</button>
          <span class="cart-item__qtd">${item.quantidade}</span>
          <button class="cart-item__btn" data-acao="mais" data-nome="${item.nome}" aria-label="Aumentar quantidade">+</button>
          <button class="cart-item__remover" data-acao="remover" data-nome="${item.nome}" aria-label="Remover item">🗑</button>
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
  const { nome, acao } = botao.dataset;
  if (acao === 'mais') alterarQuantidade(nome, 1);
  if (acao === 'menos') alterarQuantidade(nome, -1);
  if (acao === 'remover') removerDoCarrinho(nome);
});

// Delegação de eventos: cobre os botões "Adicionar" de todos os cards (já existentes e futuros)
document.addEventListener('click', (event) => {
  const botao = event.target.closest('.btn--add');
  if (!botao) return;
  adicionarAoCarrinho(botao.dataset.nome, parseFloat(botao.dataset.preco));
});

// Mostra uma mensagem rápida no rodapé da tela
function mostrarToast(mensagem) {
  toastEl.textContent = mensagem;
  toastEl.classList.add('show');
  clearTimeout(mostrarToast._timer);
  mostrarToast._timer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// Acrescenta o pedido à lista salva no localStorage (histórico usado pela tela do balcão)
function salvarPedidoNoStorage(pedido) {
  const pedidos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  pedidos.push(pedido);
  localStorage.setItem('aooba_pedidos', JSON.stringify(pedidos));
}

// Valida a mesa, monta o objeto do pedido, envia pro balcão e limpa o carrinho
function fazerPedido() {
  const mesa = mesaInput.value.trim();

  if (!mesa) {
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

  const pedido = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    tipo: 'pedido',
    mesa,
    itens: carrinho.map(item => ({ nome: item.nome, quantidade: item.quantidade, preco: item.preco })),
    total: calcularTotalCarrinho(),
    horario: new Date().toISOString(),
    status: 'pendente',
  };

  canalPedidos.postMessage(pedido); // avisa o balcão na hora, se estiver aberto
  salvarPedidoNoStorage(pedido); // garante que o balcão vê o pedido mesmo se abrir depois

  mostrarToast('Pedido enviado! O garçom já foi avisado.');

  carrinho = [];
  renderizarCarrinho();
  fecharCarrinho();
}

cartSubmit.addEventListener('click', fazerPedido);

mesaInput.addEventListener('input', () => {
  if (mesaInput.value.trim()) mesaAviso.classList.remove('show');
});

// ========================================
// FECHAR CONTA
// ========================================
//
// Envia pelo mesmo canal do pedido, mas com tipo "fechar_conta" pra o balcão
// distinguir e mostrar um alerta diferente (o cálculo do total da mesa é
// feito lá, somando os pedidos já salvos no localStorage).
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

// Junta todos os pedidos já feitos pela mesa e agrupa os itens (somando quantidades repetidas)
function obterContaDaMesa(mesa) {
  const salvos = JSON.parse(localStorage.getItem('aooba_pedidos') || '[]');
  const pedidosDaMesa = salvos.filter(pedido =>
    (pedido.tipo === 'pedido' || !pedido.tipo) && String(pedido.mesa) === String(mesa)
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

  return {
    itens: Object.values(itensAgrupados),
    total: pedidosDaMesa.reduce((soma, pedido) => soma + pedido.total, 0),
  };
}

function abrirModalFecharConta(mesa) {
  const conta = obterContaDaMesa(mesa);
  fecharContaMesaEl.textContent = mesa;

  if (conta.itens.length === 0) {
    fecharContaVazioEl.style.display = 'block';
    fecharContaItensEl.innerHTML = '';
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

  fecharContaOverlay.classList.add('is-open');
  fecharContaModal.classList.add('is-open');
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

// Só dispara o pedido de fechamento depois que o cliente confirma no modal
function confirmarFecharConta() {
  const mesa = mesaInput.value.trim();

  const fechamento = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    tipo: 'fechar_conta',
    mesa,
    horario: new Date().toISOString(),
  };

  canalPedidos.postMessage(fechamento);

  fecharModalFecharConta();
  mostrarToast('Pedido de fechamento enviado! O garçom já foi avisado.');
}

fecharContaBtn.addEventListener('click', fecharConta);
fecharContaClose.addEventListener('click', fecharModalFecharConta);
fecharContaCancelar.addEventListener('click', fecharModalFecharConta);
fecharContaOverlay.addEventListener('click', fecharModalFecharConta);
fecharContaConfirmar.addEventListener('click', confirmarFecharConta);

renderizarCarrinho();
