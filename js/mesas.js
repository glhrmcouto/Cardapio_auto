// ========================================
// MESAS — gerenciamento de mesas e tokens de QR code
// ========================================
//
// Exige as mesmas duas coisas que admin.html: sessão autenticada (Supabase
// Auth) E papel "admin" na tabela "perfis" (ver supabase/003_admin.sql).
// Login sem o papel certo é barrado e deslogado. Página extraída do antigo
// admin.html — a lógica de mesas em si não mudou, só saiu de lá pra cá.

import { supabase } from './supabaseClient.js';
import { escaparAtributo } from './shared.js';

const loginTela = document.getElementById('loginTela');
const loginForm = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginSenhaEl = document.getElementById('loginSenha');
const loginErroEl = document.getElementById('loginErro');
const loginEntrarBtn = document.getElementById('loginEntrarBtn');

const mesasPagina = document.getElementById('mesasPagina');
const sairBtn = document.getElementById('sairBtn');

const mesasCarregandoEl = document.getElementById('mesasCarregando');
const mesasErroEl = document.getElementById('mesasErro');
const mesasTentarBtn = document.getElementById('mesasTentar');
const mesasContainer = document.getElementById('mesasContainer');
const novaMesaForm = document.getElementById('novaMesaForm');
const novaMesaNumeroEl = document.getElementById('novaMesaNumero');

// ========================================
// LOGIN / LOGOUT (com checagem de papel admin)
// ========================================

function mostrarTelaLogin(mensagemErro) {
  mesasPagina.style.display = 'none';
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

// Carrega as mesas só na primeira vez que a página abre (evita recarregar
// tudo de novo se onAuthStateChange disparar outra vez, ex.: refresh de token)
let paginaIniciada = false;

async function mostrarPagina() {
  loginTela.style.display = 'none';
  mesasPagina.style.display = '';

  if (paginaIniciada) return;
  paginaIniciada = true;

  await carregarMesas();
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

  mostrarPagina();
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
    paginaIniciada = false;
    mostrarTelaLogin();
  }
});

// Checagem inicial explícita (a sessão persiste sozinha entre recarregamentos)
const { data: { session: sessaoInicial } } = await supabase.auth.getSession();
await verificarAdminEExibir(sessaoInicial);

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
// que a página está rodando — assim funciona igual em localhost, no
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
