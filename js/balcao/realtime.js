import { supabase } from '../supabaseClient.js';
import { estado } from './estado.js';
import { definirEstadoCanal, recalcularIndicadorConexao } from './conexao.js';
import { tocarBeep } from './som.js';
import { renderizarPedidos } from './fila.js';
import { renderizarFechamentos } from './fechamentos.js';
import { renderizarPagamentosPendentes } from './pagamentos.js';
import { renderizarMesasAtivas } from './mesas-ativas.js';

// ========================================
// REALTIME (Supabase)
// ========================================

let canalRealtime = null;

function ordenarPedidos() {
  estado.pedidos.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
}

// Um pedido novo chega sem os itens embutidos (o evento Realtime só traz as colunas
// da própria linha de "pedidos"), então busca os itens à parte antes de exibir.
async function lidarComInsercao(payload) {
  const novo = payload.new;

  if (novo.tipo === 'fechar_conta') {
    if (novo.status !== 'pendente') return;
    estado.fechamentos.push(novo);
    await renderizarFechamentos();
    tocarBeep('fechamento');
    return;
  }

  if (novo.status !== 'pendente') return;

  const { data: itens, error } = await supabase
    .from('pedido_itens')
    .select('nome:nome_snapshot, preco:preco_unitario, quantidade')
    .eq('pedido_id', novo.id);

  estado.pedidos.push({ ...novo, itens: error ? [] : itens });
  ordenarPedidos();
  renderizarPedidos();
  // O card de "Mesas Ativas" dessa mesa mostra os itens/total da sessão
  // inteira — precisa refletir esse pedido novo assim que ele chega.
  await renderizarMesasAtivas();
  tocarBeep('pedido');
}

// Cobre o caso de outro dispositivo/aba ter marcado "Entregue" ou "Conta Fechada"
// antes deste: tira da fila local pra não ficar dessincronizado.
function lidarComAtualizacao(payload) {
  const atualizado = payload.new;

  if (atualizado.tipo === 'fechar_conta') {
    if (atualizado.status !== 'pendente' && estado.fechamentos.some(f => f.id === atualizado.id)) {
      estado.fechamentos = estado.fechamentos.filter(f => f.id !== atualizado.id);
      renderizarFechamentos();
    }
    return;
  }

  if (atualizado.status !== 'pendente' && estado.pedidos.some(p => p.id === atualizado.id)) {
    estado.pedidos = estado.pedidos.filter(p => p.id !== atualizado.id);
    renderizarPedidos();
  }
}

// Um pagamento novo (de qualquer aparelho/aba) chega sem o número da mesa
// embutido (o evento Realtime só traz as colunas da própria linha de
// "pagamentos"), então busca a mesa à parte antes de exibir — mesmo padrão de
// lidarComInsercao pros itens do pedido.
async function lidarComInsercaoPagamento(payload) {
  const novo = payload.new;
  if (novo.status !== 'pendente') return;

  const { data: sessao, error: erroSessao } = await supabase.from('sessoes').select('mesa').eq('id', novo.sessao_id).single();
  if (erroSessao) console.error('Erro ao buscar mesa do pagamento novo:', erroSessao);

  estado.pagamentosPendentes.push({ ...novo, mesa: sessao ? sessao.mesa : '?' });
  await renderizarPagamentosPendentes();
  // Um pagamento pendente novo já entra na conta de "aguardando confirmação"
  // do saldo da mesa (ver conta_da_mesa_balcao) — sem isso, "Falta" no card
  // de fechar conta e no de "Mesas Ativas" ficava desatualizado até outra
  // ação disparar um re-render.
  await renderizarFechamentos();
  await renderizarMesasAtivas();
  tocarBeep('fechamento');
}

// Cobre o caso de outro dispositivo/aba ter confirmado o recebimento antes deste.
async function lidarComAtualizacaoPagamento(payload) {
  const atualizado = payload.new;
  if (atualizado.status === 'confirmado' && estado.pagamentosPendentes.some(p => p.id === atualizado.id)) {
    estado.pagamentosPendentes = estado.pagamentosPendentes.filter(p => p.id !== atualizado.id);
    await renderizarPagamentosPendentes();
    await renderizarFechamentos();
    await renderizarMesasAtivas();
  }
}

// Uma sessão nova (mesa recém-ocupada) entra em "Mesas Ativas" assim que o
// primeiro pedido dela é gravado (ver criar_pedido em supabase/008_sessoes.sql).
function lidarComInsercaoSessao(payload) {
  const novo = payload.new;
  if (novo.status !== 'aberta' || estado.mesasAtivas.some(s => s.id === novo.id)) return;
  estado.mesasAtivas.push(novo);
  renderizarMesasAtivas();
}

// Cobre o caso de a sessão ter sido encerrada (encerrar_sessao) por qualquer
// aparelho/aba: tira a mesa de "Mesas Ativas" sem precisar recarregar a página.
function lidarComAtualizacaoSessao(payload) {
  const atualizado = payload.new;
  if (atualizado.status !== 'aberta' && estado.mesasAtivas.some(s => s.id === atualizado.id)) {
    estado.mesasAtivas = estado.mesasAtivas.filter(s => s.id !== atualizado.id);
    renderizarMesasAtivas();
  }
}

export function inscreverRealtime() {
  canalRealtime = supabase
    .channel('balcao-pedidos')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, lidarComInsercao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, lidarComAtualizacao)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pagamentos' }, lidarComInsercaoPagamento)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pagamentos' }, lidarComAtualizacaoPagamento)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessoes' }, lidarComInsercaoSessao)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes' }, lidarComAtualizacaoSessao)
    .subscribe((status) => {
      definirEstadoCanal(status);
      recalcularIndicadorConexao();
    });
}

export function desinscreverRealtime() {
  if (canalRealtime) {
    supabase.removeChannel(canalRealtime);
    canalRealtime = null;
  }
  definirEstadoCanal('conectando');
}
