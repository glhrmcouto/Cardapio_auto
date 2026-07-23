import { supabase } from './supabaseClient.js';
import { formatarPreco } from './shared.js';

// ========================================
// AVISO DE SEM CONEXÃO
// ========================================
//
// navigator.onLine reflete a interface de rede do aparelho (wifi/dados),
// não se o Supabase especificamente está no ar — mas cobre o caso mais comum
// no salão de um bar (celular do cliente perdendo sinal), e o pedido em si
// já tem seu próprio aviso de erro se falhar por outro motivo (ver fazerPedido).

const offlineAvisoEl = document.getElementById('offlineAviso');

function atualizarAvisoOffline() {
  const offline = !navigator.onLine;
  offlineAvisoEl.classList.toggle('show', offline);
  document.body.classList.toggle('is-offline', offline);
}

// Mede a altura real do aviso (ele nunca sai do fluxo com display:none, só
// desliza pra fora da tela — ver .offline-aviso em style.css), pra barra da
// mesa/header descerem exatamente o espaço certo, mesmo se o texto quebrar
// em duas linhas numa tela estreita.
function medirAlturaOffline() {
  document.documentElement.style.setProperty('--offline-altura', `${offlineAvisoEl.offsetHeight}px`);
}

window.addEventListener('online', atualizarAvisoOffline);
window.addEventListener('offline', atualizarAvisoOffline);
window.addEventListener('resize', medirAlturaOffline);
medirAlturaOffline();
atualizarAvisoOffline();

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

// Cria o HTML de um card de narguilé: igual ao card de bebida, mas com o
// checkbox "Dividir entre a mesa" (só essa categoria tem item compartilhável —
// ver supabase/008_sessoes.sql). O estado do checkbox é lido na hora do clique
// em "Adicionar" (ver delegação de eventos mais abaixo), não fica guardado aqui.
function renderizarCardsNarguile(lista, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = lista.map(item => `
    <div class="card fade-in">
      <div class="card__header">
        <span class="card__name">${item.nome}</span>
        <span class="card__price">${formatarPreco(item.preco)}</span>
      </div>
      <p class="card__desc">${item.descricao}</p>
      <label class="card__compartilhado">
        <input type="checkbox" class="card__compartilhado-check">
        Dividir entre a mesa
      </label>
      <button class="btn btn--add" data-produto-id="${item.id}" data-nome="${item.nome}" data-preco="${item.preco}">Adicionar</button>
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
    if (categoria === 'narguile') {
      renderizarCardsNarguile(grupos[categoria], gridId);
    } else {
      renderizarCardsBebida(grupos[categoria], gridId);
    }
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
// Pedido e fechamento de conta vão direto pro Supabase (RPCs criar_pedido /
// pedir_fechamento) e a tela do balcão os recebe por ali (leitura + Realtime),
// então funciona entre aparelhos diferentes (celular do cliente + PC do balcão).

let carrinho = []; // cada item: { produtoId, nome, preco, quantidade }

const mesaInput = document.getElementById('mesaInput');
const mesaAviso = document.getElementById('mesaAviso');

// Se a página abrir com ?mesa=5&t=TOKEN na URL (QR code na mesa), pré-preenche
// o campo e TRANCA ele (readonly) — o cliente não deve poder trocar de mesa
// manualmente quando ela já veio do QR code físico da própria mesa.
//
// O token não tem campo nem UI própria: ele só existe pra ser repassado pra
// criar_pedido/pedir_fechamento (ver supabase/005_seguranca.sql), que recusam
// qualquer pedido cujo token não bata com o da mesa — sem ele (ex.: alguém
// digitando a URL só com ?mesa= manualmente, sem ter escaneado o QR físico),
// o pedido é recusado no banco, mesmo que o número da mesa exista de verdade.
const paramsUrl = new URLSearchParams(window.location.search);
const mesaDaUrl = paramsUrl.get('mesa');
const tokenMesa = paramsUrl.get('t') || '';
if (mesaDaUrl) {
  mesaInput.value = mesaDaUrl;
  mesaInput.readOnly = true;
}

// ========================================
// IDENTIFICAÇÃO DA PESSOA (nome/apelido, sem login/cadastro)
// ========================================
//
// clienteId é gerado uma vez por navegador/aba (sessionStorage, não localStorage,
// de propósito: cada visita nova — outro dia, outra pessoa no mesmo aparelho — deve
// se identificar de novo) e reaproveitado em todos os pedidos feitos nesta visita.
// É o que permite ao balcão saber "quais pedidos são da mesma pessoa" dentro da
// sessão da mesa, pro rateio de item compartilhado (ver supabase/008_sessoes.sql).

const CLIENTE_ID_KEY = 'aooba_cliente_id';
const CLIENTE_NOME_KEY = 'aooba_cliente_nome';

function obterOuCriarClienteId() {
  let id = sessionStorage.getItem(CLIENTE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CLIENTE_ID_KEY, id);
  }
  return id;
}

const clienteId = obterOuCriarClienteId();
let clienteNome = sessionStorage.getItem(CLIENTE_NOME_KEY) || '';

const nomeOverlay = document.getElementById('nomeOverlay');
const nomeModal = document.getElementById('nomeModal');
const nomeInput = document.getElementById('nomeInput');
const nomeAviso = document.getElementById('nomeAviso');
const nomeConfirmar = document.getElementById('nomeConfirmar');
const nomeCancelar = document.getElementById('nomeCancelar');
const trocarNomeBtn = document.getElementById('trocarNomeBtn');
const nomeAtualLabel = document.getElementById('nomeAtualLabel');

function atualizarLabelNome() {
  nomeAtualLabel.textContent = clienteNome || 'Identificar-se';
}

// Sem nome ainda (primeira vez nesta visita): modal é obrigatório, sem botão de
// cancelar/fechar — a pessoa precisa preencher pra continuar. Já tendo um nome
// salvo (reabrindo só pra trocar), o cancelar aparece e descarta a edição.
function abrirModalNome() {
  nomeInput.value = clienteNome;
  nomeAviso.classList.remove('show');
  nomeCancelar.style.display = clienteNome ? '' : 'none';
  nomeOverlay.classList.add('is-open');
  nomeModal.classList.add('is-open');
  setTimeout(() => nomeInput.focus(), 50);
}

function fecharModalNome() {
  nomeOverlay.classList.remove('is-open');
  nomeModal.classList.remove('is-open');
}

function confirmarNome() {
  const valor = nomeInput.value.trim();
  if (!valor) {
    nomeAviso.classList.add('show');
    nomeInput.focus();
    return;
  }
  clienteNome = valor.slice(0, 20);
  sessionStorage.setItem(CLIENTE_NOME_KEY, clienteNome);
  atualizarLabelNome();
  fecharModalNome();
}

nomeConfirmar.addEventListener('click', confirmarNome);
nomeCancelar.addEventListener('click', fecharModalNome);
nomeInput.addEventListener('input', () => {
  if (nomeInput.value.trim()) nomeAviso.classList.remove('show');
});
nomeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmarNome();
});
trocarNomeBtn.addEventListener('click', abrirModalNome);

atualizarLabelNome();
if (!clienteNome) abrirModalNome();

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
    const { error } = await supabase.rpc('criar_pedido', {
      p_mesa: Number(mesaValor),
      p_token: tokenMesa,
      p_itens: itensPayload,
      p_cliente_nome: clienteNome,
      p_cliente_id: clienteId,
    });

    if (error) throw error;

    mostrarToast('Pedido enviado! O garçom já foi avisado.');
    carrinho = [];
    renderizarCarrinho();
    fecharCarrinho();
  } catch (erro) {
    console.error('Erro ao enviar pedido:', erro);
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
const fecharContaResumoEl = document.getElementById('fecharContaResumo');
const fecharContaSubtotalEl = document.getElementById('fecharContaSubtotal');
const fecharContaTaxaEl = document.getElementById('fecharContaTaxa');
const fecharContaTotalEl = document.getElementById('fecharContaTotal');
const fecharContaClose = document.getElementById('fecharContaClose');
const fecharContaCancelar = document.getElementById('fecharContaCancelar');
const fecharContaConfirmar = document.getElementById('fecharContaConfirmar');
const fecharIndividualBtn = document.getElementById('fecharIndividualBtn');
const fecharIndividualResultado = document.getElementById('fecharIndividualResultado');
const fecharIndividualNomeEl = document.getElementById('fecharIndividualNome');
const fecharIndividualTotalEl = document.getElementById('fecharIndividualTotal');
const fecharIndividualTextoOriginal = fecharIndividualBtn.textContent;

// Abre o modal na hora (com "consultando...") e preenche assim que a RPC conta_da_mesa
// responder. Ela já ignora pedidos "finalizado", então uma mesa reaproveitada não
// arrasta o consumo de um cliente anterior. A taxa de serviço (10%) já vem
// calculada da RPC (ver supabase/006_taxa_servico.sql) — o cardápio só exibe.
async function abrirModalFecharConta(mesa) {
  fecharContaMesaEl.textContent = mesa;
  fecharContaItensEl.innerHTML = '';
  fecharContaVazioEl.textContent = 'Consultando conta...';
  fecharContaVazioEl.style.display = 'block';
  fecharContaResumoEl.style.display = 'none';
  fecharContaTotalEl.textContent = formatarPreco(0);

  // Reseta o bloco de fechamento individual toda vez que o modal abre de novo
  // (senão o resultado de uma consulta anterior ficaria visível por engano).
  fecharIndividualResultado.style.display = 'none';
  fecharIndividualBtn.style.display = '';
  fecharIndividualBtn.disabled = false;
  fecharIndividualBtn.textContent = fecharIndividualTextoOriginal;

  fecharContaOverlay.classList.add('is-open');
  fecharContaModal.classList.add('is-open');

  try {
    const { data: conta, error } = await supabase.rpc('conta_da_mesa', { p_mesa: Number(mesa), p_token: tokenMesa });

    if (error) throw error;

    if (!conta.itens || conta.itens.length === 0) {
      fecharContaVazioEl.textContent = 'Nenhum pedido registrado para essa mesa.';
      fecharContaVazioEl.style.display = 'block';
      fecharContaResumoEl.style.display = 'none';
    } else {
      fecharContaVazioEl.style.display = 'none';
      fecharContaResumoEl.style.display = 'block';
      fecharContaItensEl.innerHTML = conta.itens.map(item => `
        <li class="modal-panel__item">
          <span>${item.quantidade}x ${item.nome}</span>
          <span>${formatarPreco(item.preco * item.quantidade)}</span>
        </li>
      `).join('');
    }

    fecharContaSubtotalEl.textContent = formatarPreco(conta.subtotal);
    fecharContaTaxaEl.textContent = formatarPreco(conta.taxa_servico);
    fecharContaTotalEl.textContent = formatarPreco(conta.total);
  } catch (erro) {
    console.error('Erro ao consultar conta da mesa:', erro);
    fecharContaItensEl.innerHTML = '';
    fecharContaResumoEl.style.display = 'none';
    // erro.message vem da RPC (ver supabase/007_token_conta_mesa.sql) quando é
    // um erro de token/mesa — mensagem já pensada pra ser segura de mostrar.
    fecharContaVazioEl.textContent = erro.message || 'Não foi possível consultar a conta agora. Verifique sua conexão e tente de novo.';
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
    const { error } = await supabase.rpc('pedir_fechamento', { p_mesa: Number(mesa), p_token: tokenMesa });

    if (error) throw error;

    fecharModalFecharConta();
    mostrarToast('Pedido de fechamento enviado! O garçom já foi avisado.');
  } catch (erro) {
    console.error('Erro ao pedir fechamento:', erro);
    mostrarToast(erro.message || 'Não foi possível enviar o pedido de fechamento. Verifique sua conexão e tente de novo.');
  } finally {
    fecharContaConfirmar.disabled = false;
  }
}

fecharContaBtn.addEventListener('click', fecharConta);
fecharContaClose.addEventListener('click', fecharModalFecharConta);
fecharContaCancelar.addEventListener('click', fecharModalFecharConta);
fecharContaOverlay.addEventListener('click', fecharModalFecharConta);
fecharContaConfirmar.addEventListener('click', confirmarFecharConta);

// ========================================
// FECHAMENTO INDIVIDUAL ("fechar só a minha conta")
// ========================================
//
// Calcula o quanto ESSA pessoa deve (itens dela + rateio dos itens compartilhados
// da sessão) e grava um aviso pro balcão (fechamentos_individuais, ver
// supabase/008_sessoes.sql) — NÃO encerra a sessão da mesa, quem ficar continua
// pedindo normalmente. O resultado fica na tela pra pessoa mostrar pro garçom.
async function fecharContaIndividual() {
  const mesa = mesaInput.value.trim();
  if (!mesa) return;

  fecharIndividualBtn.disabled = true;
  fecharIndividualBtn.textContent = 'Calculando...';

  try {
    const { data, error } = await supabase.rpc('fechar_conta_individual', {
      p_mesa: Number(mesa),
      p_token: tokenMesa,
      p_cliente_id: clienteId,
    });

    if (error) throw error;

    fecharIndividualNomeEl.textContent = data.cliente_nome;
    fecharIndividualTotalEl.textContent = formatarPreco(data.total);
    fecharIndividualResultado.style.display = 'block';
    fecharIndividualBtn.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao fechar conta individual:', erro);
    mostrarToast(erro.message || 'Não foi possível calcular sua conta agora. Verifique sua conexão e tente de novo.');
    fecharIndividualBtn.disabled = false;
    fecharIndividualBtn.textContent = fecharIndividualTextoOriginal;
  }
}

fecharIndividualBtn.addEventListener('click', fecharContaIndividual);

renderizarCarrinho();
