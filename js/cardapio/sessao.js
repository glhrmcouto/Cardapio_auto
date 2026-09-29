import { supabase } from '../supabaseClient.js';
import { mostrarToast } from '../shared.js';
import { tokenMesa, temAcessoValido, mesaAtualValor } from './mesa.js';
import { carregarCardapio } from './menu.js';
import { clienteNome, abrirModalNome } from './cliente.js';

// ========================================
// SESSÃO DA MESA (token de sessão, telas de trava, tempo real)
// ========================================
//
// TOKEN DE SESSÃO (ver supabase/017_token_sessao.sql): o token DA MESA acima
// é PERMANENTE — só identifica "isto é a mesa N", nunca muda, o QR impresso
// vale pra sempre. Quem AUTORIZA pedir/fechar conta numa rodada específica é
// o token de sessão, temporário: nasce quando a sessão abre e para de valer
// automaticamente assim que ela deixa de estar 'aberta' (fechamento manual,
// automático ou por expiração — não importa o motivo).
//
// Todo pedido/fechamento carrega o tokenSessao que o navegador tem guardado.
// O servidor recusa com 'SESSAO_ENCERRADA' se ele não corresponder a uma
// sessão aberta da mesa — nesse caso a tela trava em "Iniciar novo pedido":
// só um toque explícito nesse botão (nunca o carregamento da página sozinho,
// nunca um evento em tempo real sozinho) chama abrir_sessao e gera um token
// de sessão novo. É isso que fecha o furo do F5: depois de fechar a conta e
// sair, um F5 em casa ainda tem o token DA MESA batendo (ele é permanente),
// mas o token de sessão guardado morreu com o fechamento — o cardápio não
// libera sozinho.

const SESSAO_ID_KEY = 'aooba_sessao_id';
const SESSAO_TOKEN_KEY = 'aooba_sessao_token';
const SESSAO_MESA_KEY = 'aooba_sessao_mesa';

export let sessaoId = null;
export let tokenSessao = null;
let canalSessao = null;

// ========================================
// MARCA DE "CONTA ENCERRADA" (localStorage)
// ========================================
//
// sessionStorage (ver salvarSessao) já bloqueia F5 na MESMA aba (sobrevive a reload,
// mas nasce vazio em toda aba nova). Isso deixa um furo: fechar a aba e
// abrir outra (ou reabrir o navegador) com a mesma URL do QR volta pra
// "Bem-vindo" como se fosse mesa livre, mesmo que ESTE aparelho tenha
// acabado de encerrar a conta ali. aooba_encerrada tapa esse furo
// guardando em localStorage (sobrevive a fechar/reabrir a aba) qual
// sessão este aparelho tinha quando ela foi encerrada.
//
// IMPORTANTE — escopo aceito: é só uma trava de UX no localStorage, então
// some numa aba anônima ou se alguém limpar os dados do navegador; a
// defesa de verdade contra fraude continua sendo 100% do servidor — o
// token_sessao invalidado (ver supabase/017_token_sessao.sql), validado
// de novo em toda chamada de criar_pedido/pedir_fechamento/conta_da_mesa,
// token ou não. Essa marca só evita mostrar a UI de "Bem-vindo" indevida;
// nunca é o que decide se um pedido é aceito.
const CONTA_ENCERRADA_KEY = 'aooba_encerrada';

// Grava { mesa, session_id, encerrada_em } — chamada só com o id de uma
// sessão que ESTE aparelho de fato tinha (ver mostrarContaFechada). Sem
// sessaoIdEncerrada não grava nada (evita apagar uma marca válida com um
// valor vazio por engano).
function marcarContaEncerrada(mesa, sessaoIdEncerrada) {
  if (!mesa || !sessaoIdEncerrada) return;
  try {
    localStorage.setItem(CONTA_ENCERRADA_KEY, JSON.stringify({
      mesa: String(mesa),
      session_id: sessaoIdEncerrada,
      encerrada_em: new Date().toISOString(),
    }));
  } catch (erro) {
    // localStorage indisponível (aba anônima restrita, cota cheia etc.) —
    // sem a marca, o pior caso é cair de volta no comportamento só de
    // sessionStorage; não trava a página por causa disso.
    console.warn('Não foi possível gravar aooba_encerrada:', erro);
  }
}

// Devolve a marca só se ela for desta MESMA mesa (marca de outra mesa —
// ex.: o cliente sentou em outra mesa depois — não deve bloquear nada aqui).
function lerContaEncerrada(mesa) {
  try {
    const bruto = localStorage.getItem(CONTA_ENCERRADA_KEY);
    if (!bruto) return null;
    const marca = JSON.parse(bruto);
    return marca && marca.mesa === String(mesa) ? marca : null;
  } catch (erro) {
    console.warn('Não foi possível ler aooba_encerrada:', erro);
    return null;
  }
}

// Chamada quando este aparelho passa a ter uma sessão válida de novo (ver
// salvarSessao) — o cliente legítimo que volta a pedir não pode ficar
// travado pela marca de uma conta que já não importa mais.
function limparContaEncerrada() {
  try {
    localStorage.removeItem(CONTA_ENCERRADA_KEY);
  } catch (erro) {
    console.warn('Não foi possível limpar aooba_encerrada:', erro);
  }
}

// Lê a sessão guardada de uma visita anterior a ESTA mesma mesa/aba.
// IMPORTANTE: isso nunca autoriza nada sozinho — é usado só como valor de
// COMPARAÇÃO em atualizarEstadoSessao, pra decidir "esta sessão que o
// servidor diz estar aberta é a mesma que eu já tinha confirmado entrar
// antes, ou é uma que eu preciso confirmar de novo?".
function lerSessaoStorage() {
  const mesaGuardada = sessionStorage.getItem(SESSAO_MESA_KEY);
  const idGuardado = sessionStorage.getItem(SESSAO_ID_KEY);
  const tokenGuardado = sessionStorage.getItem(SESSAO_TOKEN_KEY);
  if (mesaGuardada && idGuardado && tokenGuardado && mesaGuardada === mesaAtualValor()) {
    return { sessaoId: idGuardado, tokenSessao: tokenGuardado };
  }
  return null;
}

// Guarda sessaoId/tokenSessao (memória + sessionStorage) e reassina a trava
// em tempo real pra essa sessão — chamada só depois de CONFIRMADO que esta
// aba pode usar essa sessão (sessao_atual com token já guardado, ou toque
// explícito em "Entrar na conta"/"Iniciar novo pedido"). Nula os dois (id e
// token) pra travar a tela — nunca um sem o outro.
export function salvarSessao(id, token) {
  sessaoId = id;
  tokenSessao = token;
  if (id && token) {
    sessionStorage.setItem(SESSAO_ID_KEY, id);
    sessionStorage.setItem(SESSAO_TOKEN_KEY, token);
    sessionStorage.setItem(SESSAO_MESA_KEY, mesaAtualValor());
    // Sessão válida de novo pra este aparelho — a marca de "conta
    // encerrada" (se houver) já não representa o estado atual.
    limparContaEncerrada();
  } else {
    sessionStorage.removeItem(SESSAO_ID_KEY);
    sessionStorage.removeItem(SESSAO_TOKEN_KEY);
    sessionStorage.removeItem(SESSAO_MESA_KEY);
  }
  inscreverRealtimeSessao();
}

// Distingue a recusa "SESSAO_ENCERRADA" (ver supabase/017_token_sessao.sql)
// de qualquer outro erro de RPC — usa error.details (onde o Postgres/PostgREST
// colocam o DETAIL de uma exceção), nunca o texto da mensagem.
export function ehErroSessaoEncerrada(erro) {
  return Boolean(erro) && erro.details === 'SESSAO_ENCERRADA';
}

// Idem, pra recusa "MESA_BLOQUEADA" (ver supabase/019_bloqueio_mesa.sql) —
// mesa com fechamento total ainda não liberada pelo garçom.
export function ehErroMesaBloqueada(erro) {
  return Boolean(erro) && erro.details === 'MESA_BLOQUEADA';
}

const contaEncerradaOverlay = document.getElementById('contaEncerradaOverlay');
const contaEncerradaModal = document.getElementById('contaEncerradaModal');
const contaEncerradaTitulo = document.getElementById('contaEncerradaTitulo');
const contaEncerradaTexto = document.getElementById('contaEncerradaTexto');
const contaEncerradaAcoes = document.getElementById('contaEncerradaAcoes');
const cancelarEntradaBtn = document.getElementById('cancelarEntradaBtn');
const entrarSessaoBtn = document.getElementById('entrarSessaoBtn');
const iniciarPedidoBtn = document.getElementById('iniciarPedidoBtn');

// {sessaoId, tokenSessao} de uma sessão aberta encontrada por
// atualizarEstadoSessao mas ainda NÃO confirmada por este navegador — fica
// guardada só em memória (nunca em sessionStorage: até o toque em "Entrar na
// conta" ela não vale nada) enquanto a tela mostra a confirmação.
let sessaoPendente = null;

// Trava a tela reaproveitando o mesmo modal pros estados (ver index.html) —
// limpa qualquer sessão CONFIRMADA guardada, pra não restar estado que
// permita burlar a trava numa próxima checagem. "botoes" é a lista de ids a
// mostrar: 'cancelar', 'entrar', 'iniciar', ou [] pra nenhum. Sempre para o
// polling de "Mesa aguardando liberação" (ver pararPollingMesaBloqueada) —
// se este travarTela for justamente pra mostrar aquela tela de novo,
// mostrarMesaBloqueada reinicia o polling logo em seguida.
function travarTela(titulo, texto, botoes) {
  pararPollingMesaBloqueada();
  salvarSessao(null, null);
  contaEncerradaTitulo.textContent = titulo;
  contaEncerradaTexto.textContent = texto;
  contaEncerradaAcoes.style.display = botoes.length > 0 ? 'flex' : 'none';
  cancelarEntradaBtn.style.display = botoes.includes('cancelar') ? '' : 'none';
  entrarSessaoBtn.style.display = botoes.includes('entrar') ? '' : 'none';
  iniciarPedidoBtn.style.display = botoes.includes('iniciar') ? '' : 'none';
  contaEncerradaOverlay.classList.add('is-open');
  contaEncerradaModal.classList.add('is-open');
}

// Sem mesa+token da mesa válidos na URL. Sem botão — só re-escanear o QR
// físico resolve.
function mostrarAcessoBloqueado() {
  sessaoPendente = null;
  travarTela(
    'Conta encerrada',
    'Se você acabou de sentar, escaneie o QR code da mesa novamente para começar um novo pedido.',
    []
  );
}

// Intervalo do polling da tela "Mesa aguardando liberação" (ver
// mostrarMesaBloqueada) — guardado fora da função pra travarTela/
// destravarTela conseguirem parar de qualquer lugar (pararPollingMesaBloqueada).
let pollingMesaBloqueadaId = null;

function pararPollingMesaBloqueada() {
  if (pollingMesaBloqueadaId) {
    clearInterval(pollingMesaBloqueadaId);
    pollingMesaBloqueadaId = null;
  }
}

// Mesa+token da mesa válidos, sem sessão aberta pra essa mesa AGORA, e a
// MESA (não a sessão) está bloqueada (ver supabase/019_bloqueio_mesa.sql —
// status_mesa='bloqueada', setado sozinho no fechamento total, só um
// garçom libera de novo via liberar_mesa). Sem botão: a pessoa não tem
// nenhuma ação que resolva isso sozinha, só chamar quem trabalha no bar.
// Faz polling de status_da_mesa (RPC leve, sem segredo — nunca Realtime
// direto em "mesas", que exporia o token de todas as mesas, ver comentário
// no fim de 019_bloqueio_mesa.sql) pra destravar sozinha assim que o
// garçom liberar, sem precisar a pessoa dar F5.
export function mostrarMesaBloqueada() {
  sessaoPendente = null;
  travarTela(
    'Mesa aguardando liberação',
    'Chame um atendente para liberar o pedido nesta mesa.',
    []
  );

  pollingMesaBloqueadaId = setInterval(async () => {
    const mesaValor = mesaAtualValor();
    if (!mesaValor) return;

    try {
      const { data: status, error } = await supabase.rpc('status_da_mesa', {
        p_mesa: Number(mesaValor),
        p_token: tokenMesa,
      });
      if (error) throw error;

      if (status === 'liberada') {
        // Não chama mostrarBoasVindas direto: reconfere tudo do zero (pode
        // ter sido liberada E já ter alguém com sessão aberta nela, etc.).
        pararPollingMesaBloqueada();
        atualizarEstadoSessao();
      }
    } catch (erro) {
      // Erro de rede pontual no polling não é motivo pra travar mais forte
      // nem pra destravar — só tenta de novo no próximo tick.
      console.error('Erro ao checar liberação da mesa:', erro);
    }
  }, 8000);
}

// Mesa+token da mesa válidos, sem sessão aberta pra essa mesa AGORA, e ESTE
// navegador nunca tinha guardado nenhuma sessão dela (cliente novo/mesa
// livre) — ver mostrarSemSessaoOuEncerrada, que decide entre esta tela e
// mostrarContaFechada. Mostra "Iniciar pedido": só o toque nele (ver
// abrirNovoPedido) chama abrir_sessao e libera o cardápio.
function mostrarBoasVindas() {
  sessaoPendente = null;
  travarTela(
    'Bem-vindo ao AOOBA! BAR',
    `Toque abaixo para iniciar seu pedido na Mesa ${mesaAtualValor()}.`,
    ['iniciar']
  );
}

// Mesma falta de sessão aberta acima, mas ESTE aparelho tinha uma sessão
// que não existe mais aberta — quem estava de fato usando o cardápio
// encerrou a conta. Despedida, sem botão: só um re-scan do QR físico
// resolve. "sessaoIdEncerrada" é o id dessa sessão (de sessionStorage ou
// da marca em localStorage — ver mostrarSemSessaoOuEncerrada) e serve só
// pra (re)gravar a marca aooba_encerrada, que sobrevive a fechar/reabrir a
// aba (ver comentário em CONTA_ENCERRADA_KEY) — travarTela já limpa o
// sessionStorage (salvarSessao(null, null)), que sozinho NÃO sobrevive a
// isso.
export function mostrarContaFechada(sessaoIdEncerrada) {
  sessaoPendente = null;
  marcarContaEncerrada(mesaAtualValor(), sessaoIdEncerrada);
  travarTela(
    'Conta encerrada',
    'Obrigado pela visita! 🧡 Foi um prazer ter você no AOOBA! BAR.',
    []
  );
}

// Decide entre as duas acima quando sessao_atual não acha sessão aberta (ou
// a própria consulta falha). Duas fontes, nenhuma confia sozinha (regra 1:
// a URL/servidor manda, storage nunca autoriza nada) — só decidem QUAL
// tela mostrar:
//   - "guardada" (sessionStorage) — sobrevive a F5 na MESMA aba;
//   - a marca aooba_encerrada (localStorage) — sobrevive a fechar/reabrir
//     a aba, cobre o F5-equivalente de abrir uma aba nova com a mesma URL.
// Havendo qualquer uma das duas, é porque este aparelho estava numa sessão
// que não existe mais — CASO B. Sem nenhuma, mesa nova/cliente novo — CASO A.
// ANTES de decidir entre as duas, checa status_da_mesa (supabase/
// 019_bloqueio_mesa.sql): mesa 'bloqueada' manda pra mostrarMesaBloqueada
// sempre, independente de guardada/marca — o bloqueio de mesa é mais forte
// que "cliente novo" ou "conta encerrada" (nenhum dos dois libera cardápio
// numa mesa que o garçom ainda não confirmou estar ocupada de verdade).
async function mostrarSemSessaoOuEncerrada(guardada) {
  const mesaValor = mesaAtualValor();

  try {
    const { data: statusMesa, error } = await supabase.rpc('status_da_mesa', {
      p_mesa: Number(mesaValor),
      p_token: tokenMesa,
    });
    if (error) throw error;

    if (statusMesa === 'bloqueada') {
      console.log('[sessao] mesa bloqueada -> mostrando MESA AGUARDANDO LIBERAÇÃO');
      mostrarMesaBloqueada();
      return;
    }
  } catch (erro) {
    // Sem confirmar o status da mesa, não dá pra saber se está liberada —
    // por segurança (regra 1), segue pra decisão normal abaixo em vez de
    // arriscar liberar Boas-vindas numa mesa que pode estar bloqueada.
    console.error('Erro ao consultar status da mesa:', erro);
  }

  const marca = lerContaEncerrada(mesaValor);
  const sessaoIdEncerrada = (guardada && guardada.sessaoId) || (marca && marca.session_id) || null;
  console.log(
    '[sessao] sem sessão aberta — guardada (sessionStorage):', guardada,
    '| marca (localStorage):', marca,
    '-> mostrando', sessaoIdEncerrada ? 'CASO B (conta encerrada)' : 'CASO A (boas-vindas)'
  );
  if (sessaoIdEncerrada) {
    mostrarContaFechada(sessaoIdEncerrada);
  } else {
    mostrarBoasVindas();
  }
}

// Mesa+token da mesa válidos e JÁ HÁ sessão aberta, mas este navegador não
// tem o token_sessao dela guardado (celular novo entrando na mesa, ou aba
// sem nada guardado) — ver TESTE em supabase/017_token_sessao.sql. Isto é só
// uma BARREIRA DE UX contra entrar sem querer na conta de outro grupo; a
// segurança de verdade contra o furo do F5 continua sendo o token_sessao
// invalidado no servidor quando a sessão fecha (validado de novo em toda
// chamada de criar_pedido/pedir_fechamento/conta_da_mesa, token ou não).
// Guarda a sessão em sessaoPendente — só vira "de verdade" (salvarSessao) se
// a pessoa tocar "Entrar na conta".
function mostrarConfirmarEntrada(sessao) {
  sessaoPendente = sessao;
  travarTela(
    'Conta encerrada',
    `A Mesa ${mesaAtualValor()} já tem uma conta aberta. Deseja entrar nela para pedir junto?`,
    ['cancelar', 'entrar']
  );
}

function destravarTela() {
  pararPollingMesaBloqueada();
  contaEncerradaOverlay.classList.remove('is-open');
  contaEncerradaModal.classList.remove('is-open');
}

// Roda toda vez que a tela destrava (sessão nova, reaproveitada ou
// confirmada) — só falta pedir o nome se esta aba ainda não tiver um guardado.
// É AQUI que o cardápio é carregado pela primeira vez (nunca antes,
// nunca em paralelo com a checagem de sessão — ver comentário acima de
// cardapioTentarBtn): só depois de confirmado que esta aba pode pedir.
function aposEntrarNaSessao() {
  destravarTela();
  carregarCardapio();
  if (!clienteNome) abrirModalNome();
}

// Trava em tempo real — só CONFORTO (UX): reage na hora se a sessão fechar
// enquanto a página está aberta, sem esperar a pessoa tentar pedir de novo.
// A defesa de verdade é a validação de token_sessao dentro de
// criar_pedido/pedir_fechamento/conta_da_mesa no banco (ver
// supabase/017_token_sessao.sql) — o Realtime pode atrasar ou a conexão
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
        // Esta aba estava de fato numa sessão (é por isso que inscreveu o
        // canal, logo acima) e ela fechou agora — sempre CASO B, sem
        // precisar checar o storage.
        if (payload.new.status === 'fechada') mostrarContaFechada(sessaoId);
      }
    )
    .subscribe();
}

// Verdade vinda do servidor sobre a sessão aberta da mesa agora — SEMPRE
// reconferida no carregamento da página (regra 1: a URL manda, o storage
// nunca autoriza sozinho). Quatro desfechos:
//   - nenhuma sessão aberta E nada guardado -> mostrarBoasVindas ("Iniciar pedido");
//   - nenhuma sessão aberta MAS havia sessão guardada -> mostrarContaFechada;
//   - sessão aberta E este navegador já tinha guardado exatamente ela (mesmo
//     sessao_id, mesmo token_sessao) -> entra direto, sem reperguntar;
//   - sessão aberta mas SEM esse token guardado -> mostrarConfirmarEntrada,
//     só entra no toque explícito em "Entrar na conta".
async function atualizarEstadoSessao() {
  const mesaValor = mesaAtualValor();
  if (!mesaValor) return;

  // Candidata de uma visita anterior a ESTA mesma mesa/aba — serve tanto de
  // comparação abaixo (é a mesma sessão que o servidor diz estar aberta?)
  // quanto pra decidir, se não houver nenhuma aberta, entre boas-vindas
  // (nada guardado) e conta encerrada (havia algo guardado que não vale
  // mais) — ver mostrarSemSessaoOuEncerrada.
  const guardada = lerSessaoStorage();

  try {
    const { data, error } = await supabase.rpc('sessao_atual', { p_mesa: Number(mesaValor), p_token: tokenMesa });
    if (error) throw error;

    if (!data) {
      await mostrarSemSessaoOuEncerrada(guardada);
      return;
    }

    const jaConfirmamosEssaSessao = guardada
      && guardada.sessaoId === data.sessao_id
      && guardada.tokenSessao === data.token_sessao;

    if (jaConfirmamosEssaSessao) {
      salvarSessao(data.sessao_id, data.token_sessao);
      aposEntrarNaSessao();
    } else {
      mostrarConfirmarEntrada({ sessaoId: data.sessao_id, tokenSessao: data.token_sessao });
    }
  } catch (erro) {
    console.error('Erro ao consultar sessão atual:', erro);
    // Sem resposta do servidor não dá pra confirmar nada — por segurança,
    // trava em vez de liberar o cardápio otimisticamente (regra 1). O botão
    // de "Iniciar pedido" (quando aparece) também serve pra tentar de novo
    // nesse caso.
    await mostrarSemSessaoOuEncerrada(guardada);
  }
}

// Único caminho de CRIAÇÃO de sessão pro cliente — só sob o toque explícito
// neste botão (ver mostrarBoasVindas), nunca automático.
async function abrirNovoPedido() {
  const mesaValor = mesaAtualValor();
  if (!mesaValor) return;

  iniciarPedidoBtn.disabled = true;
  iniciarPedidoBtn.textContent = 'Abrindo...';

  try {
    const { data, error } = await supabase.rpc('abrir_sessao', { p_mesa: Number(mesaValor), p_token: tokenMesa });
    if (error) throw error;

    salvarSessao(data.sessao_id, data.token_sessao);
    aposEntrarNaSessao();
  } catch (erro) {
    console.error('Erro ao abrir novo pedido:', erro);

    if (ehErroMesaBloqueada(erro)) {
      // Corrida rara: a mesa foi bloqueada entre a checagem de status_da_mesa
      // e o toque em "Iniciar pedido" (ver supabase/019_bloqueio_mesa.sql).
      mostrarMesaBloqueada();
      return;
    }

    mostrarToast(erro.message || 'Não foi possível iniciar o pedido agora. Verifique sua conexão e tente de novo.');
  } finally {
    iniciarPedidoBtn.disabled = false;
    iniciarPedidoBtn.textContent = 'Iniciar pedido';
  }
}

// Só entra na sessão vigente com o toque explícito em "Entrar na conta" (ver
// mostrarConfirmarEntrada) — adota o token_sessao que já tinha vindo de
// sessao_atual, sem precisar de outra chamada ao servidor.
function entrarNaSessaoExistente() {
  if (!sessaoPendente) return;
  const { sessaoId: id, tokenSessao: token } = sessaoPendente;
  sessaoPendente = null;
  salvarSessao(id, token);
  aposEntrarNaSessao();
}

// "Cancelar" na confirmação de entrada: mantém a tela travada, sem acesso ao
// cardápio (ver supabase/017_token_sessao.sql) — descarta a sessão pendente
// e cai no mesmo bloqueio "sem botão" de mostrarAcessoBloqueado. Pra tentar
// de novo, só re-escaneando o QR (ou recarregando a página, que refaz a
// mesma checagem em atualizarEstadoSessao).
function cancelarEntradaSessao() {
  sessaoPendente = null;
  travarTela(
    'Conta encerrada',
    'Tudo bem. Se quiser pedir na Mesa ' + mesaAtualValor() + ', escaneie o QR code da mesa novamente.',
    []
  );
}

iniciarPedidoBtn.addEventListener('click', abrirNovoPedido);
entrarSessaoBtn.addEventListener('click', entrarNaSessaoExistente);
cancelarEntradaBtn.addEventListener('click', cancelarEntradaSessao);

if (temAcessoValido) {
  atualizarEstadoSessao();
} else {
  mostrarAcessoBloqueado();
}
