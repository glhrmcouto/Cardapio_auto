import { supabase } from '../supabaseClient.js';
import { formatarPreco } from '../shared.js';
import { estado } from './estado.js';
import { formatarHorario, htmlListaItens, htmlResumoConta, obterContaAtivaDaMesa } from './conta.js';
import { renderizarPedidos } from './fila.js';
import { renderizarMesasAtivas } from './mesas-ativas.js';

export const fechamentoGrid = document.getElementById('fechamentoGrid');

// ========================================
// FECHAMENTO DE CONTA
// ========================================

// Desenha os alertas de "fechar conta" pendentes, com o total já calculado
export async function renderizarFechamentos() {
  const cards = await Promise.all(estado.fechamentos.map(async fechamento => {
    const conta = await obterContaAtivaDaMesa(fechamento.mesa);
    const pendentes = estado.pedidos.filter(pedido => String(pedido.mesa) === String(fechamento.mesa)).length;

    return `
    <div class="fechamento-card" data-id="${fechamento.id}">
      <span class="fechamento-card__icon">⚠️</span>
      <div class="fechamento-card__mesa">MESA ${fechamento.mesa} — FECHAR CONTA</div>
      <div class="fechamento-card__horario">${formatarHorario(fechamento.criado_em)}</div>
      ${pendentes > 0 ? `<div class="fechamento-card__aviso-pendente">⚠️ Esta mesa tem ${pendentes} pedido(s) ainda não entregue(s)</div>` : ''}
      ${htmlListaItens(conta.itens)}
      ${htmlResumoConta(conta)}
      <div class="fechamento-card__total">A cobrar (saldo restante): ${formatarPreco(conta.saldoRestante)}</div>
      <button class="btn btn--primary fechamento-card__fechar" data-id="${fechamento.id}">Conta Fechada</button>
    </div>
  `;
  }));

  fechamentoGrid.innerHTML = cards.join('');
}

// Tenta encerrar a sessão sem forçar; se a RPC recusar por sobrar saldo (ver
// supabase/009_fechamento_parcial.sql), avisa quanto falta e de quem e pergunta
// se fecha mesmo assim — só então chama de novo com p_forcar=true. Qualquer
// outro erro (ex.: sessão já não existe mais) só é avisado, sem oferecer forçar.
async function tentarEncerrarSessao(mesa) {
  const { error } = await supabase.rpc('encerrar_sessao', { p_mesa: mesa, p_forcar: false });

  if (!error) return true;

  if (error.details === 'CONTA_JA_ENCERRADA') {
    // Não é erro de verdade: a sessão provavelmente já foi fechada sozinha
    // pelo encerramento automático (ver supabase/015_encerramento_automatico.sql)
    // enquanto esse card ainda estava na tela — avisa sem alarde e segue o
    // fluxo normal (finalizarFechamento limpa a UI local do mesmo jeito).
    alert(error.message);
    return true;
  }

  if (error.message && error.message.startsWith('Ainda falta receber')) {
    const confirmou = confirm(`${error.message}\n\nFechar a conta mesmo assim?`);
    if (!confirmou) return false;

    const { error: erroForcado } = await supabase.rpc('encerrar_sessao', { p_mesa: mesa, p_forcar: true });
    if (erroForcado) {
      console.error('Erro ao forçar fechamento da sessão:', erroForcado);
      alert('Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
      return false;
    }
    return true;
  }

  console.error('Erro ao finalizar fechamento:', error);
  alert(error.message || 'Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
  return false;
}

// Remove o alerta da tela e chama a RPC encerrar_sessao (ver supabase/009_fechamento_parcial.sql),
// que marca a sessão da mesa como fechada e todos os pedidos dela (consumo +
// fechar_conta) como finalizado — substitui os dois updates manuais que este
// arquivo fazia antes de existir sessão.
async function finalizarFechamento(id) {
  const fechamento = estado.fechamentos.find(f => f.id === id);
  if (!fechamento) return;

  const pendentes = estado.pedidos.filter(pedido => String(pedido.mesa) === String(fechamento.mesa)).length;
  if (pendentes > 0) {
    const confirmou = confirm(
      `Mesa ${fechamento.mesa} tem ${pendentes} pedido(s) ainda não entregue(s). Fechar a conta mesmo assim?`
    );
    if (!confirmou) return;
  }

  const botao = fechamentoGrid.querySelector(`.fechamento-card__fechar[data-id="${id}"]`);
  if (botao) botao.disabled = true;

  const sucesso = await tentarEncerrarSessao(fechamento.mesa);

  if (!sucesso) {
    if (botao) botao.disabled = false;
    return;
  }

  estado.fechamentos = estado.fechamentos.filter(f => f.id !== id);
  estado.pedidos = estado.pedidos.filter(pedido => String(pedido.mesa) !== String(fechamento.mesa));
  // Tira a mesa de "Mesas Ativas" na hora, sem esperar o Realtime da tabela
  // "sessoes" ir e voltar (que também cobre esse mesmo caso, pra quando o
  // fechamento é feito por OUTRO aparelho/aba).
  estado.mesasAtivas = estado.mesasAtivas.filter(s => String(s.mesa) !== String(fechamento.mesa));
  renderizarPedidos();
  await renderizarFechamentos();
  await renderizarMesasAtivas();
}

fechamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.fechamento-card__fechar');
  if (!botao) return;
  finalizarFechamento(botao.dataset.id);
});
