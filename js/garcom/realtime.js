import { supabase } from '../supabaseClientGarcom.js';
import { estado } from './estado.js';
import { controleMesas, carregarMesasAtivas, renderizarMesas } from './mesas.js';
import { ordenarPedidosGarcom, renderizarPedidos } from './pedidos.js';

// ========================================================================
// REALTIME (sessoes + pedidos) + POLLING (mesas) — ver comentário de
// REALTIME DA ABA MESAS no topo do arquivo pro porquê "mesas" fica de fora
// daqui (só sessoes/pedidos, ambas já publicadas — 002_realtime.sql e
// 012_realtime_sessoes.sql — nenhuma mudança de banco precisou ser feita
// pra Etapa 3)
// ========================================================================

let canalRealtime = null;

// Uma sessão nova (mesa recém-ocupada) entra pro selo "Sessão aberta".
function lidarComInsercaoSessao(payload) {
  const novo = payload.new;
  if (novo.status !== 'aberta' || estado.mesasAtivas.some(s => s.id === novo.id)) return;
  estado.mesasAtivas.push(novo);
  renderizarMesas();
}

// Sessão fechada (encerrar_sessao, de QUALQUER aparelho/aba, garçom ou
// balcão) sempre bloqueia a mesa na mesma transação (_bloquear_mesa) — é
// esse evento que avisa este aparelho, na hora, que a mesa acabou de
// bloquear, sem precisar do polling.
function lidarComAtualizacaoSessao(payload) {
  const atualizado = payload.new;
  if (atualizado.status !== 'aberta' && estado.mesasAtivas.some(s => s.id === atualizado.id)) {
    estado.mesasAtivas = estado.mesasAtivas.filter(s => s.id !== atualizado.id);
    renderizarMesas();
    controleMesas.atualizarLocal(atualizado.mesa, 'bloqueada');
  }
}

// Pedido novo (de QUALQUER mesa, feito pelo cliente pelo celular dele)
// chega sem os itens embutidos (o evento Realtime só traz as colunas da
// própria linha de "pedidos") — busca os itens à parte antes de mostrar,
// mesmo padrão de lidarComInsercao em js/balcao.js.
async function lidarComInsercaoPedido(payload) {
  const novo = payload.new;
  if (novo.tipo !== 'pedido' || novo.status !== 'pendente') return;

  const { data: itens, error } = await supabase
    .from('pedido_itens')
    .select('id, nome:nome_snapshot, preco:preco_unitario, quantidade')
    .eq('pedido_id', novo.id);

  estado.pedidosGarcom.push({ ...novo, itens: error ? [] : itens });
  ordenarPedidosGarcom();
  renderizarPedidos();
}

// Cobre o caso de outro aparelho (balcão ou outro garçom) ter marcado
// "Entregue"/fechado a conta antes deste: tira da lista local pra não
// ficar dessincronizado.
function lidarComAtualizacaoPedido(payload) {
  const atualizado = payload.new;
  if (atualizado.tipo === 'pedido' && atualizado.status !== 'pendente' && estado.pedidosGarcom.some(p => p.id === atualizado.id)) {
    estado.pedidosGarcom = estado.pedidosGarcom.filter(p => p.id !== atualizado.id);
    renderizarPedidos();
  }
}

export function inscreverRealtime() {
  canalRealtime = supabase
    .channel('garcom-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessoes' }, lidarComInsercaoSessao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes' }, lidarComAtualizacaoSessao)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, lidarComInsercaoPedido)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, lidarComAtualizacaoPedido)
    .subscribe();
}

// Cobre liberar_mesa/ativar_mesa/desativar_mesa/liberar_todas_mesas/
// bloquear_todas_mesas feitos em OUTRO aparelho — esses não passam por
// "sessoes", então não têm Realtime (ver comentário no topo do arquivo).
// 5s dá resposta quase instantânea pro garçom andando pelo salão, sem
// virar um polling pesado pro tamanho de um bar.
const INTERVALO_POLL_MESAS = 5000;
let pollIntervalId = null;

async function reconsultarMesas() {
  try {
    await Promise.all([controleMesas.carregar(), carregarMesasAtivas()]);
    renderizarMesas();
  } catch (erro) {
    // Silencioso de propósito: um poll que falha não deve incomodar o
    // garçom com alert nenhum — o próximo poll (ou uma ação manual dele)
    // tenta de novo sozinho.
    console.error('Erro no polling de mesas:', erro);
  }
}

export function iniciarPollingMesas() {
  pararPollingMesas();
  pollIntervalId = setInterval(reconsultarMesas, INTERVALO_POLL_MESAS);
}

export function pararPollingMesas() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

export function desinscreverRealtime() {
  if (canalRealtime) {
    supabase.removeChannel(canalRealtime);
    canalRealtime = null;
  }
}
