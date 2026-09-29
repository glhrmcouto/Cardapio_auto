import { supabase } from '../supabaseClient.js';

const confirmarSenhaOverlay = document.getElementById('confirmarSenhaOverlay');
const confirmarSenhaModal = document.getElementById('confirmarSenhaModal');
const confirmarSenhaInput = document.getElementById('confirmarSenhaInput');
const confirmarSenhaAviso = document.getElementById('confirmarSenhaAviso');
const confirmarSenhaCancelar = document.getElementById('confirmarSenhaCancelar');
const confirmarSenhaOk = document.getElementById('confirmarSenhaOk');

// ========================================
// CONFIRMAÇÃO DE SENHA (ações sensíveis: remover item, fechar mesa)
// ========================================
//
// Reautentica com signInWithPassword usando o e-mail JÁ logado (supabase.auth.getUser) —
// isso não troca de conta nem cria sessão nova de verdade, só confirma que quem está
// com a mão no balcão agora sabe a senha antes de uma ação difícil de desfazer
// (remover item de pedido, fechar mesa direto). Qualquer erro (senha errada, sem
// conexão) recusa e mantém o modal aberto pra tentar de novo.

let acaoPendenteSenha = null;

export function pedirConfirmacaoSenha(acao) {
  acaoPendenteSenha = acao;
  confirmarSenhaInput.value = '';
  confirmarSenhaAviso.classList.remove('show');
  confirmarSenhaOverlay.classList.add('is-open');
  confirmarSenhaModal.classList.add('is-open');
  confirmarSenhaInput.focus();
}

function fecharConfirmacaoSenha() {
  acaoPendenteSenha = null;
  confirmarSenhaOverlay.classList.remove('is-open');
  confirmarSenhaModal.classList.remove('is-open');
}

async function confirmarSenha() {
  const senha = confirmarSenhaInput.value;
  const acao = acaoPendenteSenha;

  if (!senha || !acao) return;

  confirmarSenhaOk.disabled = true;
  confirmarSenhaOk.textContent = 'Confirmando...';
  confirmarSenhaAviso.classList.remove('show');

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.auth.signInWithPassword({ email: user?.email, password: senha });

  confirmarSenhaOk.disabled = false;
  confirmarSenhaOk.textContent = 'Confirmar';

  if (error) {
    confirmarSenhaAviso.classList.add('show');
    confirmarSenhaInput.focus();
    confirmarSenhaInput.select();
    return;
  }

  fecharConfirmacaoSenha();
  await acao();
}

confirmarSenhaCancelar.addEventListener('click', fecharConfirmacaoSenha);
confirmarSenhaOverlay.addEventListener('click', fecharConfirmacaoSenha);
confirmarSenhaOk.addEventListener('click', confirmarSenha);
confirmarSenhaInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmarSenha();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && confirmarSenhaModal.classList.contains('is-open')) {
    fecharConfirmacaoSenha();
  }
});

