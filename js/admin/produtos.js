import { supabase } from '../supabaseClient.js';
import { formatarPreco, escaparTexto, escaparAtributo, LABEL_CATEGORIA, ORDEM_CATEGORIAS } from '../shared.js';
import { mostrarFeedback } from './feedback.js';

const produtosCarregandoEl = document.getElementById('produtosCarregando');
const produtosErroEl = document.getElementById('produtosErro');
const produtosTentarBtn = document.getElementById('produtosTentar');
const categoriasContainer = document.getElementById('categoriasContainer');
const adicionarProdutoBtn = document.getElementById('adicionarProdutoBtn');
const novoProdutoContainer = document.getElementById('novoProdutoContainer');

// ========================================
// CARREGAMENTO / LISTAGEM DE PRODUTOS
// ========================================
//
// O admin vê TODOS os produtos, inclusive inativos (diferente do cardápio
// público, que só mostra ativo = true) — precisa disso pra poder reativar.

let todosProdutos = []; // cache local, atualizado a cada carregar/salvar/mover

export async function carregarProdutos() {
  produtosCarregandoEl.style.display = 'block';
  produtosErroEl.style.display = 'none';
  categoriasContainer.innerHTML = '';

  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('id, nome, descricao, preco, categoria, ativo, ordem')
      .order('categoria')
      .order('ordem');

    if (error) throw error;

    todosProdutos = data;
    renderizarProdutos();
    produtosCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar produtos:', erro);
    produtosCarregandoEl.style.display = 'none';
    produtosErroEl.style.display = 'block';
  }
}

produtosTentarBtn.addEventListener('click', carregarProdutos);

function agruparPorCategoria(produtos) {
  const grupos = {};
  ORDEM_CATEGORIAS.forEach(categoria => { grupos[categoria] = []; });
  produtos.forEach(produto => {
    if (!grupos[produto.categoria]) grupos[produto.categoria] = [];
    grupos[produto.categoria].push(produto);
  });
  return grupos;
}

function construirOpcoesCategoria(categoriaAtual) {
  return ORDEM_CATEGORIAS.map(categoria => `
    <option value="${categoria}" ${categoria === categoriaAtual ? 'selected' : ''}>${LABEL_CATEGORIA[categoria]}</option>
  `).join('');
}

function renderizarProdutoCard(produto) {
  const statusClasse = produto.ativo ? 'admin-produto-card__status--ativo' : 'admin-produto-card__status--inativo';
  const statusTexto = produto.ativo ? 'Ativo' : 'Inativo';
  const textoAlternarAtivo = produto.ativo ? 'Desativar' : 'Ativar';

  return `
    <div class="admin-produto-card ${produto.ativo ? '' : 'admin-produto-card--inativo'}" data-id="${produto.id}">
      <div class="admin-produto-card__topo">
        <span class="admin-produto-card__status ${statusClasse}">${statusTexto}</span>
      </div>

      <div class="admin-produto-card__campo">
        <label>Nome</label>
        <input type="text" class="admin-produto-card__input" data-campo="nome" value="${escaparAtributo(produto.nome)}">
      </div>

      <div class="admin-produto-card__campo">
        <label>Descrição</label>
        <textarea class="admin-produto-card__input" data-campo="descricao" rows="2">${escaparTexto(produto.descricao)}</textarea>
      </div>

      <div class="admin-produto-card__linha">
        <div class="admin-produto-card__campo">
          <label>Preço</label>
          <input type="text" inputmode="numeric" class="admin-produto-card__input" data-campo="preco" value="${escaparAtributo(formatarPreco(produto.preco))}">
        </div>
        <div class="admin-produto-card__campo">
          <label>Categoria</label>
          <select class="admin-produto-card__input" data-campo="categoria">
            ${construirOpcoesCategoria(produto.categoria)}
          </select>
        </div>
      </div>

      <div class="admin-produto-card__campo admin-produto-card__campo--ordem">
        <label>Ordem na categoria</label>
        <div class="admin-produto-card__ordem-controles">
          <button type="button" class="admin-produto-card__seta" data-acao="subir" aria-label="Mover pra cima na categoria">▲</button>
          <input type="number" class="admin-produto-card__input admin-produto-card__ordem-input" data-campo="ordem" value="${produto.ordem}" min="0">
          <button type="button" class="admin-produto-card__seta" data-acao="descer" aria-label="Mover pra baixo na categoria">▼</button>
        </div>
      </div>

      <div class="admin-produto-card__acoes">
        <button type="button" class="btn admin-produto-card__excluir" data-acao="excluir">Excluir</button>
        <button type="button" class="btn btn--secondary" data-acao="alternar-ativo">${textoAlternarAtivo}</button>
        <button type="button" class="btn btn--primary" data-acao="salvar">Salvar</button>
      </div>
      <p class="admin-produto-card__feedback" role="status"></p>
    </div>
  `;
}

function renderizarProdutos() {
  const grupos = agruparPorCategoria(todosProdutos);

  categoriasContainer.innerHTML = ORDEM_CATEGORIAS
    .filter(categoria => grupos[categoria] && grupos[categoria].length > 0)
    .map(categoria => `
      <section class="admin-categoria" data-categoria="${categoria}">
        <h2 class="admin-categoria__titulo">${LABEL_CATEGORIA[categoria] || categoria}</h2>
        <div class="admin-categoria__lista">
          ${grupos[categoria].map(renderizarProdutoCard).join('')}
        </div>
      </section>
    `).join('');
}

// ========================================
// MÁSCARA DE PREÇO (R$)
// ========================================
//
// Trata o campo como "centavos digitados": a cada tecla, pega só os dígitos
// e formata como moeda. Sempre produz um valor >= 0 — não tem como digitar
// negativo nesse esquema.

function formatarComoMascaraPreco(valorBruto) {
  const digitos = valorBruto.replace(/\D/g, '');
  const centavos = parseInt(digitos || '0', 10);
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function precoMascaradoParaNumero(valorMascarado) {
  const digitos = valorMascarado.replace(/\D/g, '');
  return parseInt(digitos || '0', 10) / 100;
}

// ========================================
// LEITURA + VALIDAÇÃO DOS CAMPOS DE UM CARD (editar ou criar)
// ========================================
//
// Devolve { nome, descricao, preco, categoria, ordem } ou null — nesse caso
// já mostrou no próprio card qual campo está inválido.

function lerCamposProduto(card) {
  const nome = card.querySelector('[data-campo="nome"]').value.trim();
  const descricao = card.querySelector('[data-campo="descricao"]').value.trim();
  const precoTexto = card.querySelector('[data-campo="preco"]').value;
  const categoria = card.querySelector('[data-campo="categoria"]').value;
  const ordemTexto = card.querySelector('[data-campo="ordem"]').value;

  const preco = precoMascaradoParaNumero(precoTexto);
  const ordem = parseInt(ordemTexto, 10);

  if (!nome) {
    mostrarFeedback(card, 'O nome não pode ficar vazio.', 'erro');
    return null;
  }
  if (!Number.isFinite(preco) || preco < 0) {
    mostrarFeedback(card, 'Preço inválido.', 'erro');
    return null;
  }
  if (!Number.isFinite(ordem) || ordem < 0) {
    mostrarFeedback(card, 'Ordem inválida.', 'erro');
    return null;
  }

  return { nome, descricao, preco, categoria, ordem };
}

// ========================================
// SALVAR EDIÇÃO INLINE
// ========================================

async function salvarProduto(id, card) {
  const campos = lerCamposProduto(card);
  if (!campos) return;
  const { nome, descricao, preco, categoria, ordem } = campos;

  const botaoSalvar = card.querySelector('[data-acao="salvar"]');
  botaoSalvar.disabled = true;
  botaoSalvar.textContent = 'Salvando...';

  const { error } = await supabase
    .from('produtos')
    .update({ nome, descricao, preco, categoria, ordem })
    .eq('id', id);

  botaoSalvar.disabled = false;
  botaoSalvar.textContent = 'Salvar';

  if (error) {
    console.error('Erro ao salvar produto:', error);
    mostrarFeedback(card, 'Não foi possível salvar. Verifique sua conexão e tente de novo.', 'erro');
    return;
  }

  const produtoLocal = todosProdutos.find(p => p.id === id);
  const categoriaMudou = produtoLocal.categoria !== categoria;
  Object.assign(produtoLocal, { nome, descricao, preco, categoria, ordem });

  if (categoriaMudou) {
    // Categoria mudou: precisa mover o card de seção, então re-renderiza tudo
    renderizarProdutos();
    const cardNovo = categoriasContainer.querySelector(`.admin-produto-card[data-id="${id}"]`);
    if (cardNovo) mostrarFeedback(cardNovo, 'Salvo com sucesso!', 'sucesso');
  } else {
    mostrarFeedback(card, 'Salvo com sucesso!', 'sucesso');
  }
}

// ========================================
// ATIVAR / DESATIVAR
// ========================================
// Não deleta nada — só tira do cardápio público (RLS de anon exige ativo=true).
// O histórico de pedidos que já usaram esse produto continua intacto.

async function alternarAtivo(id, card) {
  const produto = todosProdutos.find(p => p.id === id);
  if (!produto) return;

  const novoValor = !produto.ativo;
  const botao = card.querySelector('[data-acao="alternar-ativo"]');
  botao.disabled = true;

  const { error } = await supabase.from('produtos').update({ ativo: novoValor }).eq('id', id);

  if (error) {
    console.error('Erro ao ativar/desativar produto:', error);
    botao.disabled = false;
    mostrarFeedback(card, 'Não foi possível atualizar o status. Tente de novo.', 'erro');
    return;
  }

  produto.ativo = novoValor;
  renderizarProdutos();
  const cardNovo = categoriasContainer.querySelector(`.admin-produto-card[data-id="${id}"]`);
  if (cardNovo) mostrarFeedback(cardNovo, novoValor ? 'Produto ativado.' : 'Produto desativado.', 'sucesso');
}

// ========================================
// EXCLUIR (só se o produto nunca foi pedido)
// ========================================
//
// Não existe checagem prévia "já foi pedido?" — é o próprio banco que garante
// isso: a FK pedido_itens.produto_id -> produtos(id) (sem "on delete cascade",
// ver 001_schema.sql) recusa o DELETE com o erro 23503 (foreign_key_violation)
// se existir qualquer pedido_itens apontando pra esse produto. Só capturamos
// esse código e trocamos por uma mensagem amigável.

async function excluirProduto(id, card) {
  const produto = todosProdutos.find(p => p.id === id);
  if (!produto) return;

  const confirmou = confirm(`Tem certeza que deseja excluir "${produto.nome}"? Essa ação não pode ser desfeita.`);
  if (!confirmou) return;

  const botao = card.querySelector('[data-acao="excluir"]');
  botao.disabled = true;
  botao.textContent = 'Excluindo...';

  const { error } = await supabase.from('produtos').delete().eq('id', id);

  if (error) {
    botao.disabled = false;
    botao.textContent = 'Excluir';

    if (error.code === '23503') {
      mostrarFeedback(card, 'Este produto já foi pedido alguma vez — não dá pra excluir. Desative-o em vez disso.', 'erro');
    } else {
      console.error('Erro ao excluir produto:', error);
      mostrarFeedback(card, 'Não foi possível excluir agora. Verifique sua conexão e tente de novo.', 'erro');
    }
    return;
  }

  todosProdutos = todosProdutos.filter(p => p.id !== id);
  renderizarProdutos();
}

// ========================================
// REORDENAR (setas pra cima/baixo dentro da mesma categoria)
// ========================================

async function moverProduto(id, direcao) {
  const produto = todosProdutos.find(p => p.id === id);
  if (!produto) return;

  const doGrupo = todosProdutos
    .filter(p => p.categoria === produto.categoria)
    .sort((a, b) => a.ordem - b.ordem);

  const indice = doGrupo.findIndex(p => p.id === id);
  const indiceVizinho = direcao === 'subir' ? indice - 1 : indice + 1;
  if (indiceVizinho < 0 || indiceVizinho >= doGrupo.length) return; // já é o primeiro/último

  const vizinho = doGrupo[indiceVizinho];
  const ordemProduto = produto.ordem;
  const ordemVizinho = vizinho.ordem;

  const card = categoriasContainer.querySelector(`.admin-produto-card[data-id="${id}"]`);

  const [{ error: erro1 }, { error: erro2 }] = await Promise.all([
    supabase.from('produtos').update({ ordem: ordemVizinho }).eq('id', produto.id),
    supabase.from('produtos').update({ ordem: ordemProduto }).eq('id', vizinho.id),
  ]);

  if (erro1 || erro2) {
    console.error('Erro ao reordenar produtos:', erro1 || erro2);
    if (card) mostrarFeedback(card, 'Não foi possível reordenar agora. Tente de novo.', 'erro');
    return;
  }

  produto.ordem = ordemVizinho;
  vizinho.ordem = ordemProduto;
  renderizarProdutos();
}

// ========================================
// EVENTOS (delegados no container de categorias)
// ========================================

categoriasContainer.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-acao]');
  if (!botao) return;

  const card = botao.closest('.admin-produto-card');
  const id = Number(card.dataset.id);
  const acao = botao.dataset.acao;

  if (acao === 'salvar') salvarProduto(id, card);
  else if (acao === 'alternar-ativo') alternarAtivo(id, card);
  else if (acao === 'subir') moverProduto(id, 'subir');
  else if (acao === 'descer') moverProduto(id, 'descer');
  else if (acao === 'excluir') excluirProduto(id, card);
});

categoriasContainer.addEventListener('input', (event) => {
  if (event.target.dataset.campo === 'preco') {
    event.target.value = formatarComoMascaraPreco(event.target.value);
  }
});

// ========================================
// ADICIONAR PRODUTO NOVO
// ========================================
//
// O rascunho aparece num container à parte (acima das categorias), não dentro
// de uma seção — só quando o admin escolhe a categoria é que o produto de
// fato existe nela; até lá não faz sentido já encaixar o card em algum lugar.

function proximaOrdemDaCategoria(categoria) {
  const doGrupo = todosProdutos.filter(p => p.categoria === categoria);
  if (doGrupo.length === 0) return 1;
  return Math.max(...doGrupo.map(p => p.ordem)) + 1;
}

function renderizarCardNovoProduto() {
  const categoriaInicial = ORDEM_CATEGORIAS[0];
  const ordemSugerida = proximaOrdemDaCategoria(categoriaInicial);

  return `
    <div class="admin-produto-card admin-produto-card--novo">
      <div class="admin-produto-card__topo">
        <span class="admin-produto-card__status admin-produto-card__status--novo">Novo produto</span>
      </div>

      <div class="admin-produto-card__campo">
        <label>Nome</label>
        <input type="text" class="admin-produto-card__input" data-campo="nome" placeholder="Ex: Caipirinha">
      </div>

      <div class="admin-produto-card__campo">
        <label>Descrição</label>
        <textarea class="admin-produto-card__input" data-campo="descricao" rows="2" placeholder="Descrição curta do item"></textarea>
      </div>

      <div class="admin-produto-card__linha">
        <div class="admin-produto-card__campo">
          <label>Preço</label>
          <input type="text" inputmode="numeric" class="admin-produto-card__input" data-campo="preco" value="R$ 0,00">
        </div>
        <div class="admin-produto-card__campo">
          <label>Categoria</label>
          <select class="admin-produto-card__input" data-campo="categoria">
            ${construirOpcoesCategoria(categoriaInicial)}
          </select>
        </div>
      </div>

      <div class="admin-produto-card__campo admin-produto-card__campo--ordem">
        <label>Ordem na categoria</label>
        <input type="number" class="admin-produto-card__input" data-campo="ordem" value="${ordemSugerida}" min="0">
      </div>

      <div class="admin-produto-card__acoes">
        <button type="button" class="btn btn--secondary" data-acao="cancelar-novo">Cancelar</button>
        <button type="button" class="btn btn--primary" data-acao="criar">Criar produto</button>
      </div>
      <p class="admin-produto-card__feedback" role="status"></p>
    </div>
  `;
}

adicionarProdutoBtn.addEventListener('click', () => {
  if (novoProdutoContainer.children.length > 0) return; // já tem um rascunho aberto

  novoProdutoContainer.innerHTML = renderizarCardNovoProduto();
  novoProdutoContainer.querySelector('[data-campo="nome"]').focus();
});

async function criarProduto(card) {
  const campos = lerCamposProduto(card);
  if (!campos) return;
  const { nome, descricao, preco, categoria, ordem } = campos;

  const botaoCriar = card.querySelector('[data-acao="criar"]');
  botaoCriar.disabled = true;
  botaoCriar.textContent = 'Criando...';

  const { data: produtoNovo, error } = await supabase
    .from('produtos')
    .insert({ nome, descricao, preco, categoria, ordem, ativo: true })
    .select()
    .single();

  if (error) {
    console.error('Erro ao criar produto:', error);
    botaoCriar.disabled = false;
    botaoCriar.textContent = 'Criar produto';
    mostrarFeedback(card, 'Não foi possível criar o produto. Verifique sua conexão e tente de novo.', 'erro');
    return;
  }

  todosProdutos.push(produtoNovo);
  novoProdutoContainer.innerHTML = '';
  renderizarProdutos();
}

novoProdutoContainer.addEventListener('input', (event) => {
  if (event.target.dataset.campo === 'preco') {
    event.target.value = formatarComoMascaraPreco(event.target.value);
  }
});

// Se o admin trocar a categoria ANTES de criar, sugere a próxima ordem já
// considerando a nova categoria escolhida (só faz sentido pro rascunho ainda
// não salvo — produtos existentes mantêm a ordem que o admin já escolheu).
novoProdutoContainer.addEventListener('change', (event) => {
  if (event.target.dataset.campo === 'categoria') {
    const ordemInput = novoProdutoContainer.querySelector('[data-campo="ordem"]');
    ordemInput.value = proximaOrdemDaCategoria(event.target.value);
  }
});

novoProdutoContainer.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-acao]');
  if (!botao) return;

  const card = botao.closest('.admin-produto-card');

  if (botao.dataset.acao === 'cancelar-novo') {
    novoProdutoContainer.innerHTML = '';
  } else if (botao.dataset.acao === 'criar') {
    criarProduto(card);
  }
});
