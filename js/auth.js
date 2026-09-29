// ========================================================================
// Login/logout compartilhado pelas telas com acesso restrito (balcão,
// garçom, admin, mesas, relatórios, QR codes). Todas usam o mesmo bloco de
// HTML de login (#loginTela, #loginForm, #loginEmail, #loginSenha,
// #loginErro, #loginEntrarBtn) e um botão #sairBtn.
//
// Duas variações, escolhidas por "papeis":
// - papeis: lista de papéis aceitos (ex.: ['admin']) — além da sessão, exige
//   um desses papéis na tabela "perfis" (ver supabase/003_admin.sql e
//   023_papel_garcom.sql). Login sem o papel certo é barrado e deslogado.
//   Aqui o onAuthStateChange só reage a LOGOUT, pra não checar o papel de
//   novo a cada refresh automático de token.
// - papeis: null (balcão) — basta a sessão. O onAuthStateChange cuida de
//   login E logout, inclusive feitos em outra aba (o supabase-js propaga a
//   mudança de sessão entre abas do mesmo navegador).
//
// aoEntrar(papel) roda só na primeira vez que o conteúdo aparece depois de
// logar (evita recarregar/assinar Realtime de novo se onAuthStateChange
// disparar outra vez); aoSair roda a cada logout, antes de voltar pra tela
// de login.
// ========================================================================

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
// "await" no topo do módulo só suspende a CONTINUAÇÃO do próprio módulo
// (qualquer "let" declarado depois ainda estaria na zona morta temporal).
//
// "cliente" é o client Supabase da página: o de js/supabaseClient.js, ou o
// de js/supabaseClientGarcom.js na tela do garçom, que tem sessão própria.
// Este arquivo não importa nenhum dos dois de propósito — importar o
// principal aqui criaria ele também na tela do garçom.
export async function configurarLogin({
  cliente,
  conteudoEl,
  papeis,
  mensagemSemPermissao = 'Este usuário não tem permissão de administrador.',
  aoEntrar,
  aoSair,
}) {
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

  function mostrarConteudo(papel) {
    loginTela.style.display = 'none';
    conteudoEl.style.display = '';

    if (iniciado) return;
    iniciado = true;

    aoEntrar(papel);
  }

  // Verifica se a sessão logada pertence a um usuário com um dos papéis
  // aceitos em "perfis" — checagem direta no client (SELECT simples,
  // permitido pela policy perfis_select_proprio). É só UX: as RPCs e o RLS
  // conferem o papel de novo no banco.
  async function verificarPapelEExibir(session) {
    if (!session) {
      mostrarTelaLogin();
      return;
    }

    const { data: perfil, error } = await cliente
      .from('perfis')
      .select('papel')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) {
      console.error('Erro ao verificar permissão de acesso:', error);
      mostrarTelaLogin('Não foi possível verificar sua permissão agora. Tente de novo.');
      await cliente.auth.signOut();
      return;
    }

    if (!perfil || !papeis.includes(perfil.papel)) {
      mostrarTelaLogin(mensagemSemPermissao);
      await cliente.auth.signOut();
      return;
    }

    mostrarConteudo(perfil.papel);
  }

  async function verificarEExibir(session) {
    if (papeis) {
      await verificarPapelEExibir(session);
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

    const { data, error } = await cliente.auth.signInWithPassword({
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

    // Sem checagem de papel, o onAuthStateChange (abaixo) já cuida de trocar de tela.
    if (papeis) await verificarPapelEExibir(data.session);
  });

  sairBtn.addEventListener('click', () => {
    cliente.auth.signOut();
  });

  cliente.auth.onAuthStateChange((_evento, session) => {
    if (session) {
      if (!papeis) mostrarConteudo();
      return;
    }
    iniciado = false;
    aoSair?.();
    mostrarTelaLogin();
  });

  const { data: { session: sessaoInicial } } = await cliente.auth.getSession();
  await verificarEExibir(sessaoInicial);
}
