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

export const clienteId = obterOuCriarClienteId();
export let clienteNome = sessionStorage.getItem(CLIENTE_NOME_KEY) || '';

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
export function abrirModalNome() {
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
// Sem sessão ativa (acesso bloqueado OU sem sessão aberta ainda), a tela já
// está travada no overlay — não faz sentido empilhar o modal de nome por
// cima dele. O modal de nome só abre depois de entrar numa sessão de
// verdade (ver aposEntrarNaSessao, na seção "BLOQUEIO DE ACESSO + TOKEN DE
// SESSÃO"), não mais aqui incondicionalmente.
