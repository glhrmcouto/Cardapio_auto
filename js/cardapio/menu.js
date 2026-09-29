import { supabase } from '../supabaseClient.js';
import { formatarPreco } from '../shared.js';

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
