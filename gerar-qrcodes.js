// ========================================
// GERAR QR CODES — um QR por mesa ativa, direto da tabela "mesas"
// ========================================
//
// Mesmo login e checagem de papel admin do admin.html (ver
// supabase/003_admin.sql) — sem isso ninguém, nem "authenticated" sem
// papel admin, consegue ler a tabela "mesas" (RLS, ver
// supabase/005_seguranca.sql), então essa tela precisa do mesmo login.

import { supabase } from './supabaseClient.js';

const loginTela = document.getElementById('loginTela');
const loginForm = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginSenhaEl = document.getElementById('loginSenha');
const loginErroEl = document.getElementById('loginErro');
const loginEntrarBtn = document.getElementById('loginEntrarBtn');

const qrPagina = document.getElementById('qrPagina');
const sairBtn = document.getElementById('sairBtn');

const qrCarregandoEl = document.getElementById('qrCarregando');
const qrErroEl = document.getElementById('qrErro');
const qrErroTextoEl = document.getElementById('qrErroTexto');
const qrTentarBtn = document.getElementById('qrTentar');
const qrVazioEl = document.getElementById('qrVazio');
const qrGrid = document.getElementById('qrGrid');
const qrImprimirBtn = document.getElementById('qrImprimirBtn');
const qrRecarregarBtn = document.getElementById('qrRecarregarBtn');

let paginaIniciada = false;

// ========================================
// LOGIN / LOGOUT (com checagem de papel admin)
// ========================================

function mostrarTelaLogin(mensagemErro) {
  qrPagina.style.display = 'none';
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

function mostrarPagina() {
  loginTela.style.display = 'none';
  qrPagina.style.display = '';

  if (paginaIniciada) return;
  paginaIniciada = true;

  carregarEGerarQrCodes();
}

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

// ========================================
// MESAS -> QR CODES
// ========================================

// Mesma lógica do admin.html: monta a URL a partir do domínio onde esta
// própria página está rodando (localhost, preview do Netlify, produção...),
// sem precisar fixar domínio nenhum aqui.
function montarUrlMesa(mesa) {
  return `${window.location.origin}/index.html?mesa=${mesa.numero}&t=${mesa.token}`;
}

async function gerarQrCodes(mesas) {
  qrGrid.innerHTML = '';

  for (const mesa of mesas) {
    const url = montarUrlMesa(mesa);

    const card = document.createElement('div');
    card.className = 'qr-card';
    card.innerHTML = `
      <span class="qr-card__marca">AOOBA! BAR</span>
      <span class="qr-card__mesa-label">Mesa</span>
      <span class="qr-card__mesa-numero">${mesa.numero}</span>
      <canvas class="qr-card__canvas"></canvas>
      <p class="qr-card__instrucao">Aponte a câmera do celular<br>e peça direto pela mesa.</p>
    `;
    qrGrid.appendChild(card);

    // A URL (com o token) não aparece em texto no card impresso de propósito —
    // só o QR code carrega ela; escrever o token também em texto legível na
    // mesa seria dar de bandeja o mesmo segredo que o QR já protege.
    const canvas = card.querySelector('canvas');
    try {
      await QRCode.toCanvas(canvas, url, {
        width: 200,
        margin: 1,
        color: { dark: '#1a1a1a', light: '#ffffff' },
      });
    } catch (erro) {
      console.error(`Erro ao gerar QR code da mesa ${mesa.numero}:`, erro);
      canvas.remove();
      card.insertAdjacentHTML('beforeend', '<span class="qr-card__falha">Não foi possível gerar este QR code.</span>');
    }
  }
}

async function carregarEGerarQrCodes() {
  qrCarregandoEl.style.display = 'block';
  qrErroEl.style.display = 'none';
  qrVazioEl.style.display = 'none';
  qrGrid.innerHTML = '';

  // Checagem explícita em vez de deixar cada card falhar em silêncio um por
  // um: se o script do CDN (qrcode.min.js) não carregou — CDN fora do ar,
  // bloqueador de conteúdo, URL da versão quebrada — "QRCode" nunca existe
  // no navegador. Sem isso, o sintoma era N cards, cada um com "não foi
  // possível gerar", sem pista nenhuma do motivo real.
  if (typeof QRCode === 'undefined') {
    qrCarregandoEl.style.display = 'none';
    qrErroTextoEl.textContent = 'A biblioteca de QR code não carregou (falha ao buscar o script do CDN). Verifique sua conexão e tente de novo.';
    qrErroEl.style.display = 'block';
    return;
  }

  try {
    const { data, error } = await supabase
      .from('mesas')
      .select('numero, token, ativa')
      .eq('ativa', true)
      .order('numero');

    if (error) throw error;

    qrCarregandoEl.style.display = 'none';

    if (data.length === 0) {
      qrVazioEl.style.display = 'block';
      return;
    }

    await gerarQrCodes(data);
  } catch (erro) {
    console.error('Erro ao carregar mesas:', erro);
    qrCarregandoEl.style.display = 'none';
    qrErroTextoEl.textContent = 'Não foi possível carregar as mesas agora. Verifique sua conexão e tente de novo.';
    qrErroEl.style.display = 'block';
  }
}

qrTentarBtn.addEventListener('click', carregarEGerarQrCodes);
qrRecarregarBtn.addEventListener('click', carregarEGerarQrCodes);
qrImprimirBtn.addEventListener('click', () => window.print());

// ========================================
// BOOTSTRAP (fica por último de propósito)
// ========================================
//
// verificarAdminEExibir() dispara mostrarPagina() -> carregarEGerarQrCodes()
// de forma síncrona (sem "await" no meio). Se esse bootstrap ficasse ANTES
// das declarações acima, uma chamada síncrona poderia esbarrar numa delas
// antes de ela ter rodado — o "await" no topo do módulo só suspende a
// CONTINUAÇÃO do próprio módulo; tudo que vem depois dele só existe de fato
// depois que essa promise resolve (mesmo erro já visto em relatorios.js).

supabase.auth.onAuthStateChange((_evento, session) => {
  if (!session) {
    paginaIniciada = false;
    mostrarTelaLogin();
  }
});

const { data: { session: sessaoInicial } } = await supabase.auth.getSession();
await verificarAdminEExibir(sessaoInicial);
