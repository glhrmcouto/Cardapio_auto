import { supabase } from '../supabaseClient.js';

// ========================================
// MESA (campo do número + parâmetros do QR code)
// ========================================

export const mesaInput = document.getElementById('mesaInput');
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
export const tokenMesa = paramsUrl.get('t') || '';
if (mesaDaUrl) {
  mesaInput.value = mesaDaUrl;
  mesaInput.readOnly = true;
}

// Devolve o número da mesa do campo; se estiver vazio, mostra o aviso ao lado
// do campo, rola até ele e devolve null (usado antes de pedir e de abrir a conta).
export function exigirMesa() {
  const mesa = mesaInput.value.trim();

  if (!mesa) {
    mesaAviso.classList.add('show');
    mesaInput.focus();
    mesaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }
  mesaAviso.classList.remove('show');
  return mesa;
}

mesaInput.addEventListener('input', () => {
  if (mesaInput.value.trim()) mesaAviso.classList.remove('show');
});

// ========================================
// BLOQUEIO DE ACESSO + VÍNCULO DE SESSÃO
// ========================================
//
// BLOQUEIO DE ACESSO (item 3): o número da mesa é adivinhável (é só um
// inteiro pequeno na URL); o token não (ver mesas.token em
// supabase/005_seguranca.sql). Por isso a ÚNICA forma de liberar o cardápio
// pra pedido é abrir o link do QR físico da mesa, que traz os dois:
// ?mesa=N&t=TOKEN. Sem os dois, nem tenta consultar sessão nenhuma — trava
// direto na tela "Conta encerrada" (reaproveitada aqui como "acesso
// bloqueado"), pedindo pra escanear o QR. A validação de verdade continua
// sendo a do servidor (criar_pedido/pedir_fechamento/conta_da_mesa exigem e
// conferem o token — ver 005_seguranca.sql e 014_sessao_vinculada.sql);
// isso aqui só evita mostrar uma UI de pedido que o banco ia recusar de
// qualquer jeito.
export const temAcessoValido = Boolean(mesaDaUrl && tokenMesa);

// VÍNCULO DE SESSÃO (corrige o bug de "mesa que vira" — ver
// supabase/014_sessao_vinculada.sql): sem isso, criar_pedido/
// pedir_fechamento/conta_da_mesa só sabiam "qual é a sessão aberta da mesa
// AGORA" (pelo número da mesa) — não "em qual sessão ESTE celular estava".
// Se o garçom fechasse a conta (encerrar_sessao, manual ou automático — ver
// 015_encerramento_automatico.sql) e um cliente novo sentasse na mesma
// mesa, um celular antigo que ainda estivesse com o cardápio aberto
// conseguia mandar pedido, e ele caía direto na comanda do cliente novo.
//
// Todo pedido/fechamento carrega o session_id que o navegador tem guardado
// (sessaoId). O servidor recusa com 'SESSAO_ENCERRADA' se esse session_id
// não for mais o da sessão aberta da mesa — nesse caso a UI trava
// PERMANENTEMENTE no overlay "Conta encerrada": diferente da versão
// anterior desta tela, não existe mais um botão que reabre/reaproveita
// sessão pela própria página — a única saída é re-escanear o QR físico
// (mesmo raciocínio do bloqueio de acesso acima: garante que só quem está
// fisicamente na mesa consegue voltar a pedir).

const SESSAO_ID_KEY = 'aooba_sessao_id';
const SESSAO_MESA_KEY = 'aooba_sessao_mesa';

export let sessaoId = null;
let canalSessao = null;

function mesaAtualValor() {
  return mesaDaUrl || mesaInput.value.trim();
}

// Lê o session_id salvo de uma visita anterior a esta mesma mesa. IMPORTANTE:
// isso NUNCA autoriza nada sozinho — é usado só como valor de COMPARAÇÃO em
// atualizarSessaoAtual, pra detectar "essa sessão que eu tinha guardada
// ainda é a mesma que o servidor diz estar aberta?". sessaoId (a variável
// que de fato viaja nos pedidos) só é setado depois dessa validação.
function lerSessaoStorage() {
  const mesaGuardada = sessionStorage.getItem(SESSAO_MESA_KEY);
  const idGuardado = sessionStorage.getItem(SESSAO_ID_KEY);
  return mesaGuardada && idGuardado && mesaGuardada === mesaAtualValor() ? idGuardado : null;
}

// Atualiza sessaoId (memória + sessionStorage) e reassina a trava em tempo
// real pra essa sessão nova — chamada tanto pela consulta inicial (depois de
// validada, ver atualizarSessaoAtual) quanto pelo session_id que volta em
// cada pedido/fechamento bem-sucedido.
export function salvarSessao(id) {
  sessaoId = id;
  if (id) {
    sessionStorage.setItem(SESSAO_ID_KEY, id);
    sessionStorage.setItem(SESSAO_MESA_KEY, mesaAtualValor());
  } else {
    sessionStorage.removeItem(SESSAO_ID_KEY);
    sessionStorage.removeItem(SESSAO_MESA_KEY);
  }
  inscreverRealtimeSessao();
}

// Verdade vinda do servidor sobre qual é a sessão aberta da mesa agora —
// SEMPRE reconferida no carregamento da página; o sessionStorage nunca
// autoriza sozinho (regra 1: a URL manda, o storage nunca). Corrige o furo
// em que um F5 depois de "Conta encerrada" reaproveitava o session_id
// antigo do storage sem re-checar nada: antes, sessaoId era preenchido
// direto de lerSessaoStorage() e essa função só sobrescrevia silenciosamente
// com o que o servidor respondesse, sem nunca travar a tela nesse caminho.
async function atualizarSessaoAtual() {
  const mesaValor = mesaAtualValor();
  if (!mesaValor) return;

  // Candidato guardado de uma visita anterior a ESTA mesma mesa/aba — pode
  // já estar morto (sessão encerrada enquanto a aba estava fechada ou em
  // segundo plano, sem receber o Realtime). Só serve de comparação abaixo,
  // nunca é atribuído a sessaoId antes de validar.
  const sessaoAnterior = lerSessaoStorage();

  try {
    const { data, error } = await supabase.rpc('sessao_atual', { p_mesa: Number(mesaValor), p_token: tokenMesa });
    if (error) throw error;

    if (sessaoAnterior && sessaoAnterior !== data) {
      // Tínhamos uma sessão guardada e ela NÃO é (mais) a sessão aberta
      // atual da mesa, segundo o servidor — foi encerrada nesse meio-tempo
      // (ou uma sessão diferente abriu depois). Nunca reaproveita
      // silenciosamente: trava a tela (mostrarContaEncerrada já limpa o
      // storage) em vez de liberar o cardápio como se nada tivesse acontecido.
      mostrarContaEncerrada();
      return;
    }

    salvarSessao(data);
  } catch (erro) {
    console.error('Erro ao consultar sessão atual:', erro);
    // Sem resposta do servidor não dá pra confirmar NEM invalidar a sessão
    // guardada — por segurança, não reaproveita ela otimistamente (regra 1).
    // sessaoId fica null; qualquer pedido/fechamento tentado nesse meio-tempo
    // ainda é validado de novo no banco (criar_pedido etc. exigem o token e
    // conferem a sessão de qualquer forma).
  }
}

// Distingue a recusa "SESSAO_ENCERRADA" (ver supabase/014_sessao_vinculada.sql)
// de qualquer outro erro de RPC — usa error.details (onde o Postgres/PostgREST
// colocam o DETAIL de uma exceção), nunca o texto da mensagem.
export function ehErroSessaoEncerrada(erro) {
  return Boolean(erro) && erro.details === 'SESSAO_ENCERRADA';
}

const contaEncerradaOverlay = document.getElementById('contaEncerradaOverlay');
const contaEncerradaModal = document.getElementById('contaEncerradaModal');

// Trava permanentemente a tela (sem botão de saída — ver comentário no topo
// desta seção) e limpa qualquer session_id antigo do sessionStorage, pra
// não restar estado que permita burlar o bloqueio numa próxima visita a
// essa mesma aba/mesa.
export function mostrarContaEncerrada() {
  salvarSessao(null);
  contaEncerradaOverlay.classList.add('is-open');
  contaEncerradaModal.classList.add('is-open');
}

// Trava em tempo real — só CONFORTO (UX): reage na hora se a sessão fechar
// enquanto a página está aberta, sem esperar a pessoa tentar pedir de novo.
// A defesa de verdade é a validação de session_id dentro de
// criar_pedido/pedir_fechamento/conta_da_mesa no banco (ver
// supabase/014_sessao_vinculada.sql) — o Realtime pode atrasar ou a conexão
// pode cair sem a gente perceber, então NUNCA confie só nisso aqui.
function inscreverRealtimeSessao() {
  if (canalSessao) {
    supabase.removeChannel(canalSessao);
    canalSessao = null;
  }
  if (!sessaoId) return;

  canalSessao = supabase
    .channel(`sessao-cliente-${sessaoId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessoes', filter: `id=eq.${sessaoId}` },
      (payload) => {
        if (payload.new.status === 'fechada') mostrarContaEncerrada();
      }
    )
    .subscribe();
}

if (temAcessoValido) {
  // sessaoId começa null e só é preenchido depois de atualizarSessaoAtual
  // validar (ou não) o que estiver no sessionStorage contra o servidor —
  // nunca antes disso (regra 1: a URL manda, o storage nunca autoriza sozinho).
  atualizarSessaoAtual();
} else {
  mostrarContaEncerrada();
}
