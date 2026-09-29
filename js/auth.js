// ========================================================================
// Login/logout compartilhado pelas telas com acesso restrito (balcão,
// admin, relatórios, QR codes). Todas usam o mesmo bloco de HTML de login
// (#loginTela, #loginForm, #loginEmail, #loginSenha, #loginErro,
// #loginEntrarBtn) e um botão #sairBtn.
//
// Duas variações:
// - exigirAdmin: true (admin, relatórios, QR codes) — além da sessão, exige
//   papel "admin" na tabela "perfis" (ver supabase/003_admin.sql). Login sem
//   o papel certo é barrado e deslogado. Aqui o onAuthStateChange só reage a
//   LOGOUT, pra não checar o papel de novo a cada refresh automático de token.
// - exigirAdmin: false (balcão) — basta a sessão. O onAuthStateChange cuida
//   de login E logout, inclusive feitos em outra aba (o supabase-js propaga
//   a mudança de sessão entre abas do mesmo navegador).
//
// aoEntrar roda só na primeira vez que o conteúdo aparece depois de logar
// (evita recarregar/assinar Realtime de novo se onAuthStateChange disparar
// outra vez); aoSair roda a cada logout, antes de voltar pra tela de login.
// ========================================================================

import { supabase } from './supabaseClient.js';

const loginTela = document.getElementById('loginTela');
const loginForm = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginSenhaEl = document.getElementById('loginSenha');
const loginErroEl = document.getElementById('loginErro');
const loginEntrarBtn = document.getElementById('loginEntrarBtn');
const sairBtn = document.getElementById('sairBtn');

// Registra os handlers de login/logout e faz a checagem inicial de sessão (a
// sessão persiste sozinha entre recarregamentos, no localStorage). Chame com
// "await" no FIM do módulo da página: aoEntrar pode rodar de forma síncrona
// daqui, então toda declaração que ele usa já precisa ter acontecido — o
// "await" no topo do módulo só suspende a CONTINUAÇÃO do próprio módulo.
export async function configurarLogin({ conteudoEl, exigirAdmin, aoEntrar, aoSair }) {
  let iniciado = false;

  function mostrarTelaLogin(mensagemErro) {
    conteudoEl.style.display = 'none';
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

  function mostrarConteudo() {
    loginTela.style.display = 'none';
    conteudoEl.style.display = '';

    if (iniciado) return;
    iniciado = true;

    aoEntrar();
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

    mostrarConteudo();
  }

  async function verificarEExibir(session) {
    if (exigirAdmin) {
      await verificarAdminEExibir(session);
    } else if (session) {
      mostrarConteudo();
    } else {
      mostrarTelaLogin();
    }
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

    // Sem exigirAdmin, o onAuthStateChange (abaixo) já cuida de trocar de tela.
    if (exigirAdmin) await verificarAdminEExibir(data.session);
  });

  sairBtn.addEventListener('click', () => {
    supabase.auth.signOut();
  });

  supabase.auth.onAuthStateChange((_evento, session) => {
    if (session) {
      if (!exigirAdmin) mostrarConteudo();
      return;
    }
    iniciado = false;
    aoSair?.();
    mostrarTelaLogin();
  });

  const { data: { session: sessaoInicial } } = await supabase.auth.getSession();
  await verificarEExibir(sessaoInicial);
}
