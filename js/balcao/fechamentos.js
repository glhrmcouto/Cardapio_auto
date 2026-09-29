import { formatarPreco } from '../shared.js';
import { estado } from './estado.js';
import { formatarHorario, htmlListaItens, htmlResumoConta, obterContaAtivaDaMesa, tentarEncerrarSessao } from './conta.js';
import { pedirConfirmacaoSenha } from './senha.js';
import { controleMesas } from './controle.js';
import { renderizarPedidos } from './fila.js';
import { mesasAtivasGrid, renderizarMesasAtivas } from './mesas-ativas.js';

export const fechamentoGrid = document.getElementById('fechamentoGrid');

// ========================================
// FECHAMENTO DE CONTA
// ========================================
//
// Dois caminhos, os dois via tentarEncerrarSessao (conta.js): responder o
// alerta de "fechar conta" que o cliente mandou, ou fechar direto pelo
// botão "Fechar mesa" do card em Mesas Ativas.

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
  // encerrar_sessao (dentro de tentarEncerrarSessao) já bloqueou a mesa
  // sozinha no banco — ver supabase/019_bloqueio_mesa.sql.
  controleMesas.atualizarLocal(fechamento.mesa, 'bloqueada');
}

fechamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.fechamento-card__fechar');
  if (!botao) return;
  finalizarFechamento(botao.dataset.id);
});

// Fecha a mesa direto (sem esperar o cliente pedir "Fechar a conta" pelo
// cardápio) — ex.: cliente foi embora sem pedir fechamento. Reaproveita
// tentarEncerrarSessao (mesmo aviso de saldo pendente/confirmação de forçar
// que o fluxo de responder um pedido de fechamento já usa).
async function fecharMesaDireto(mesa, botao) {
  if (botao) botao.disabled = true;

  const sucesso = await tentarEncerrarSessao(mesa);

  if (!sucesso) {
    if (botao) botao.disabled = false;
    return;
  }

  estado.pedidos = estado.pedidos.filter(pedido => String(pedido.mesa) !== String(mesa));
  estado.fechamentos = estado.fechamentos.filter(f => String(f.mesa) !== String(mesa));
  estado.mesasAtivas = estado.mesasAtivas.filter(s => String(s.mesa) !== String(mesa));
  renderizarPedidos();
  await renderizarFechamentos();
  await renderizarMesasAtivas();
  controleMesas.atualizarLocal(mesa, 'bloqueada');
}

mesasAtivasGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.mesa-ativa-card__fechar');
  if (!botao) return;
  const mesa = botao.dataset.mesa;
  pedirConfirmacaoSenha(() => fecharMesaDireto(mesa, botao));
});
