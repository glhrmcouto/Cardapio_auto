// ========================================
// PAINEL ADMIN — edição do cardápio (produtos)
// ========================================
//
// Exige duas coisas pra mostrar qualquer coisa: sessão autenticada (Supabase
// Auth, igual balcao.html) E papel "admin" na tabela "perfis" (ver
// supabase/003_admin.sql). Login sem o papel certo é barrado e deslogado.

import { supabase } from './supabaseClient.js';
import { formatarPreco, escaparTexto, escaparAtributo } from './shared.js';

const loginTela = document.getElementById('loginTela');
const loginForm = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginSenhaEl = document.getElementById('loginSenha');
const loginErroEl = document.getElementById('loginErro');
const loginEntrarBtn = document.getElementById('loginEntrarBtn');

const adminConteudo = document.getElementById('adminConteudo');
const sairBtn = document.getElementById('sairBtn');

const produtosCarregandoEl = document.getElementById('produtosCarregando');
const produtosErroEl = document.getElementById('produtosErro');
const produtosTentarBtn = document.getElementById('produtosTentar');
const categoriasContainer = document.getElementById('categoriasContainer');
const adicionarProdutoBtn = document.getElementById('adicionarProdutoBtn');
const novoProdutoContainer = document.getElementById('novoProdutoContainer');

const mesasCarregandoEl = document.getElementById('mesasCarregando');
const mesasErroEl = document.getElementById('mesasErro');
const mesasTentarBtn = document.getElementById('mesasTentar');
const mesasContainer = document.getElementById('mesasContainer');
const novaMesaForm = document.getElementById('novaMesaForm');
const novaMesaNumeroEl = document.getElementById('novaMesaNumero');

const LABEL_CATEGORIA = {
  drink: 'Drinks',
  cerveja: 'Cervejas',
  sem_alcool: 'Sem Álcool',
  narguile: 'Narguilé',
  essencia: 'Essências',
};
const ORDEM_CATEGORIAS = ['drink', 'cerveja', 'sem_alcool', 'narguile', 'essencia'];

// ========================================
// LOGIN / LOGOUT (com checagem de papel admin)
// ========================================

function mostrarTelaLogin(mensagemErro) {
  adminConteudo.style.display = 'none';
  loginTela.style.display = 'flex';
  loginEmailEl.value = '';
  loginSenhaEl.value = '';

  if (mensagemErro) {
    loginErroEl.textContent = mensagemErro;
    loginErroEl.style.display = 'block';
  } else {
    loginErroEl.style.display = 'none';
  }
}

// Carrega os produtos só na primeira vez que o painel abre (evita recarregar
// tudo de novo se onAuthStateChange disparar outra vez, ex.: refresh de token)
let adminIniciado = false;

async function mostrarPainelAdmin() {
  loginTela.style.display = 'none';
  adminConteudo.style.display = '';

  if (adminIniciado) return;
  adminIniciado = true;

  await Promise.all([carregarProdutos(), carregarMesas()]);
}

// Verifica se a sessão logada pertence a um usuário com papel "admin" em
// "perfis". Login com credenciais válidas mas sem esse papel é barrado aqui.
async function verificarAdminEExibir(session) {
  if (!session) {
    mostrarTelaLogin();
    return;
  }

  const { data: perfil, error } = await supabase
    .from('perfis')
    .select('papel')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Erro ao verificar permissão de admin:', error);
    mostrarTelaLogin('Não foi possível verificar sua permissão agora. Tente de novo.');
    await supabase.auth.signOut();
    return;
  }

  if (!perfil || perfil.papel !== 'admin') {
    mostrarTelaLogin('Este usuário não tem permissão de administrador.');
    await supabase.auth.signOut();
    return;
  }

  mostrarPainelAdmin();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginEntrarBtn.disabled = true;
  loginEntrarBtn.textContent = 'Entrando...';
  loginErroEl.style.display = 'none';

  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmailEl.value.trim(),
    password: loginSenhaEl.value,
  });

  loginEntrarBtn.disabled = false;
  loginEntrarBtn.textContent = 'Entrar';

  if (error) {
    loginErroEl.textContent = 'E-mail ou senha inválidos.';
    loginErroEl.style.display = 'block';
    return;
  }

  await verificarAdminEExibir(data.session);
});

sairBtn.addEventListener('click', () => {
  supabase.auth.signOut();
});

// Só reage a LOGOUT aqui — o login bem-sucedido já é tratado logo acima
// (via verificarAdminEExibir), pra não checar o papel de novo a cada refresh
// automático de token.
supabase.auth.onAuthStateChange((_evento, session) => {
  if (!session) {
    adminIniciado = false;
    mostrarTelaLogin();
  }
});

// Checagem inicial explícita (a sessão persiste sozinha entre recarregamentos)
const { data: { session: sessaoInicial } } = await supabase.auth.getSession();
await verificarAdminEExibir(sessaoInicial);

// ========================================
// CARREGAMENTO / LISTAGEM DE PRODUTOS
// ========================================
//
// O admin vê TODOS os produtos, inclusive inativos (diferente do cardápio
// público, que só mostra ativo = true) — precisa disso pra poder reativar.

let todosProdutos = []; // cache local, atualizado a cada carregar/salvar/mover

async function carregarProdutos() {
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
// FEEDBACK DE SALVAR (sucesso/erro, some sozinho depois de alguns segundos)
// ========================================

function mostrarFeedback(card, mensagem, tipo) {
  const feedbackEl = card.querySelector('.admin-produto-card__feedback');
  feedbackEl.textContent = mensagem;
  feedbackEl.classList.remove('admin-produto-card__feedback--sucesso', 'admin-produto-card__feedback--erro');
  feedbackEl.classList.add(tipo === 'sucesso' ? 'admin-produto-card__feedback--sucesso' : 'admin-produto-card__feedback--erro');

  clearTimeout(feedbackEl._timer);
  feedbackEl._timer = setTimeout(() => {
    feedbackEl.textContent = '';
  }, 4000);
}

// ========================================
// SALVAR EDIÇÃO INLINE
// ========================================

async function salvarProduto(id, card) {
  const nome = card.querySelector('[data-campo="nome"]').value.trim();
  const descricao = card.querySelector('[data-campo="descricao"]').value.trim();
  const precoTexto = card.querySelector('[data-campo="preco"]').value;
  const categoria = card.querySelector('[data-campo="categoria"]').value;
  const ordemTexto = card.querySelector('[data-campo="ordem"]').value;

  const preco = precoMascaradoParaNumero(precoTexto);
  const ordem = parseInt(ordemTexto, 10);

  if (!nome) {
    mostrarFeedback(card, 'O nome não pode ficar vazio.', 'erro');
    return;
  }
  if (!Number.isFinite(preco) || preco < 0) {
    mostrarFeedback(card, 'Preço inválido.', 'erro');
    return;
  }
  if (!Number.isFinite(ordem) || ordem < 0) {
    mostrarFeedback(card, 'Ordem inválida.', 'erro');
    return;
  }

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
  const nome = card.querySelector('[data-campo="nome"]').value.trim();
  const descricao = card.querySelector('[data-campo="descricao"]').value.trim();
  const precoTexto = card.querySelector('[data-campo="preco"]').value;
  const categoria = card.querySelector('[data-campo="categoria"]').value;
  const ordemTexto = card.querySelector('[data-campo="ordem"]').value;

  const preco = precoMascaradoParaNumero(precoTexto);
  const ordem = parseInt(ordemTexto, 10);

  if (!nome) {
    mostrarFeedback(card, 'O nome não pode ficar vazio.', 'erro');
    return;
  }
  if (!Number.isFinite(preco) || preco < 0) {
    mostrarFeedback(card, 'Preço inválido.', 'erro');
    return;
  }
  if (!Number.isFinite(ordem) || ordem < 0) {
    mostrarFeedback(card, 'Ordem inválida.', 'erro');
    return;
  }

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

// ========================================
// MESAS (token do QR code — ver supabase/005_seguranca.sql)
// ========================================
//
// Cada mesa tem um token secreto que autoriza criar_pedido/pedir_fechamento
// pra ela; sem ele (ou com o número errado), a RPC recusa o pedido no banco
// mesmo que a mesa exista de verdade. Esse painel é o único lugar que expõe
// o token em texto — faz sentido, já que só admin autenticado chega aqui.

let todasMesas = [];

async function carregarMesas() {
  mesasCarregandoEl.style.display = 'block';
  mesasErroEl.style.display = 'none';
  mesasContainer.innerHTML = '';

  try {
    const { data, error } = await supabase
      .from('mesas')
      .select('numero, token, ativa')
      .order('numero');

    if (error) throw error;

    todasMesas = data;
    renderizarMesas();
    mesasCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar mesas:', erro);
    mesasCarregandoEl.style.display = 'none';
    mesasErroEl.style.display = 'block';
  }
}

mesasTentarBtn.addEventListener('click', carregarMesas);

// Monta a URL exata que deve virar QR code, a partir do próprio domínio em
// que o admin.html está rodando — assim funciona igual em localhost, no
// preview do Netlify e no domínio final, sem precisar fixar nada aqui.
function montarUrlMesa(mesa) {
  return `${window.location.origin}/index.html?mesa=${mesa.numero}&t=${mesa.token}`;
}

function renderizarMesaCard(mesa) {
  const statusClasse = mesa.ativa ? 'admin-produto-card__status--ativo' : 'admin-produto-card__status--inativo';
  const statusTexto = mesa.ativa ? 'Ativa' : 'Inativa';
  const textoAlternar = mesa.ativa ? 'Desativar' : 'Ativar';

  return `
    <div class="admin-produto-card admin-mesa-card ${mesa.ativa ? '' : 'admin-produto-card--inativo'}" data-numero="${mesa.numero}">
      <div class="admin-produto-card__topo">
        <span class="admin-mesa-card__numero">Mesa ${mesa.numero}</span>
        <span class="admin-produto-card__status ${statusClasse}">${statusTexto}</span>
      </div>

      <div class="admin-produto-card__campo">
        <label>Link do QR code</label>
        <input type="text" class="admin-produto-card__input admin-mesa-card__url" value="${escaparAtributo(montarUrlMesa(mesa))}" readonly>
      </div>

      <div class="admin-produto-card__acoes">
        <button type="button" class="btn btn--secondary" data-acao="copiar-link">Copiar link</button>
        <button type="button" class="btn btn--secondary" data-acao="alternar-ativa">${textoAlternar}</button>
        <button type="button" class="btn btn--secondary" data-acao="regerar-token">Regerar token</button>
      </div>
      <p class="admin-produto-card__feedback" role="status"></p>
    </div>
  `;
}

function renderizarMesas() {
  if (todasMesas.length === 0) {
    mesasContainer.innerHTML = '<p class="cardapio-status">Nenhuma mesa cadastrada ainda — adicione uma acima.</p>';
    return;
  }
  mesasContainer.innerHTML = todasMesas.map(renderizarMesaCard).join('');
}

async function copiarLinkMesa(mesa, card) {
  const url = montarUrlMesa(mesa);
  try {
    await navigator.clipboard.writeText(url);
    mostrarFeedback(card, 'Link copiado!', 'sucesso');
  } catch (erro) {
    console.error('Erro ao copiar link da mesa:', erro);
    const input = card.querySelector('.admin-mesa-card__url');
    input.select();
    mostrarFeedback(card, 'Não copiou sozinho — o link já está selecionado, copie manualmente (Ctrl+C).', 'erro');
  }
}

async function alternarAtivaMesa(numero, card) {
  const mesa = todasMesas.find(m => m.numero === numero);
  if (!mesa) return;

  const novoValor = !mesa.ativa;
  const botao = card.querySelector('[data-acao="alternar-ativa"]');
  botao.disabled = true;

  const { error } = await supabase.from('mesas').update({ ativa: novoValor }).eq('numero', numero);

  if (error) {
    console.error('Erro ao ativar/desativar mesa:', error);
    botao.disabled = false;
    mostrarFeedback(card, 'Não foi possível atualizar o status. Tente de novo.', 'erro');
    return;
  }

  mesa.ativa = novoValor;
  renderizarMesas();
  const cardNovo = mesasContainer.querySelector(`.admin-mesa-card[data-numero="${numero}"]`);
  if (cardNovo) mostrarFeedback(cardNovo, novoValor ? 'Mesa ativada.' : 'Mesa desativada.', 'sucesso');
}

// Gera um token novo pra mesa (RPC regenerar_token_mesa, restrita a admin —
// ver 005_seguranca.sql). O QR code impresso com o token antigo para de
// funcionar na hora; é preciso reimprimir com o link novo mostrado aqui.
async function regerarTokenMesa(numero, card) {
  const confirmou = confirm(`Gerar um novo link pra mesa ${numero}? O QR code impresso hoje vai parar de funcionar assim que você confirmar.`);
  if (!confirmou) return;

  const botao = card.querySelector('[data-acao="regerar-token"]');
  botao.disabled = true;
  botao.textContent = 'Gerando...';

  const { data, error } = await supabase.rpc('regenerar_token_mesa', { p_numero: numero });

  botao.disabled = false;
  botao.textContent = 'Regerar token';

  if (error) {
    console.error('Erro ao regerar token da mesa:', error);
    mostrarFeedback(card, 'Não foi possível gerar um novo link agora. Tente de novo.', 'erro');
    return;
  }

  const mesaLocal = todasMesas.find(m => m.numero === numero);
  Object.assign(mesaLocal, data);
  renderizarMesas();
  const cardNovo = mesasContainer.querySelector(`.admin-mesa-card[data-numero="${numero}"]`);
  if (cardNovo) mostrarFeedback(cardNovo, 'Novo link gerado! Reimprima o QR code dessa mesa.', 'sucesso');
}

mesasContainer.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-acao]');
  if (!botao) return;

  const card = botao.closest('.admin-mesa-card');
  const numero = Number(card.dataset.numero);
  const mesa = todasMesas.find(m => m.numero === numero);
  const acao = botao.dataset.acao;

  if (acao === 'copiar-link') copiarLinkMesa(mesa, card);
  else if (acao === 'alternar-ativa') alternarAtivaMesa(numero, card);
  else if (acao === 'regerar-token') regerarTokenMesa(numero, card);
});

novaMesaForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const numero = parseInt(novaMesaNumeroEl.value, 10);
  if (!Number.isFinite(numero) || numero <= 0) return;

  const botaoAdicionar = novaMesaForm.querySelector('button[type="submit"]');
  botaoAdicionar.disabled = true;

  // O token nasce sozinho no banco (DEFAULT da coluna, ver 005_seguranca.sql)
  // — nunca gerado aqui no navegador.
  const { data: mesaNova, error } = await supabase
    .from('mesas')
    .insert({ numero })
    .select('numero, token, ativa')
    .single();

  botaoAdicionar.disabled = false;

  if (error) {
    console.error('Erro ao adicionar mesa:', error);
    alert(error.code === '23505' ? `A mesa ${numero} já existe.` : 'Não foi possível adicionar a mesa agora. Verifique sua conexão e tente de novo.');
    return;
  }

  novaMesaForm.reset();
  todasMesas.push(mesaNova);
  todasMesas.sort((a, b) => a.numero - b.numero);
  renderizarMesas();
});
