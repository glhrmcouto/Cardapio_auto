import { supabase } from '../supabaseClient.js';
import { formatarPreco, escaparTexto, mostrarToast } from '../shared.js';
import { estado } from './estado.js';
import { formatarHorario } from './conta.js';
import { renderizarPedidos } from './fila.js';
import { renderizarFechamentos } from './fechamentos.js';
import { renderizarMesasAtivas } from './mesas-ativas.js';

export const pagamentoGrid = document.getElementById('pagamentoGrid');

// ========================================
// PAGAMENTO PARCIAL ("fechar minha parte")
// ========================================
//
// Diferente do fechamento da mesa inteira: não mexe em pedidos nem na sessão,
// só cobra a parte já congelada daquela pessoa (ver fechar_parcial em
// supabase/009_fechamento_parcial.sql). Cada card busca o detalhe (itens
// diretos + fatias de compartilhados) via detalhe_pagamento antes de
// desenhar, igual ao padrão já usado em renderizarFechamentos.

export async function renderizarPagamentosPendentes() {
  const cards = await Promise.all(estado.pagamentosPendentes.map(async pagamento => {
    const { data: detalhe, error } = await supabase.rpc('detalhe_pagamento', { p_pagamento_id: pagamento.id });
    const itensDiretos = error || !detalhe ? [] : detalhe.itens_diretos;
    const itensCompartilhados = error || !detalhe ? [] : detalhe.itens_compartilhados;

    return `
    <div class="pagamento-card" data-id="${pagamento.id}">
      <div class="pagamento-card__titulo">MESA ${pagamento.mesa} — <strong>${escaparTexto(pagamento.nome)}</strong> quer fechar: ${formatarPreco(pagamento.valor_total)}</div>
      <div class="pagamento-card__horario">${formatarHorario(pagamento.criado_em)}</div>
      ${!pagamento.taxa_aceita ? '<div class="pagamento-card__sem-taxa">⚠️ Recusou a taxa de serviço</div>' : ''}
      <ul class="pagamento-card__itens">
        ${itensDiretos.map(item => `
          <li><span>${item.quantidade}x ${item.nome}</span><span>${formatarPreco(item.preco * item.quantidade)}</span></li>
        `).join('')}
        ${itensCompartilhados.map(item => `
          <li><span>${item.nome} (fração compartilhada)</span><span>${formatarPreco(item.valor)}</span></li>
        `).join('')}
      </ul>
      <div class="pagamento-card__resumo">
        <div class="pagamento-card__linha"><span>Subtotal</span><span>${formatarPreco(pagamento.subtotal)}</span></div>
        <div class="pagamento-card__linha"><span>Serviço</span><span>${formatarPreco(pagamento.taxa_servico)}</span></div>
        <div class="pagamento-card__linha pagamento-card__linha--total"><span>Total</span><span>${formatarPreco(pagamento.valor_total)}</span></div>
      </div>
      <button class="btn btn--primary pagamento-card__ok" data-id="${pagamento.id}">Recebido</button>
    </div>
  `;
  }));

  pagamentoGrid.innerHTML = cards.join('');
}

// Confirma o recebimento via RPC (confirmar_pagamento) em vez de update direto
// na tabela — assim confirmado_em e a validação de "só se ainda tava pendente"
// ficam garantidos no banco, não dependem do front-end estar correto.
async function confirmarRecebimentoPagamento(id) {
  const botao = pagamentoGrid.querySelector(`.pagamento-card__ok[data-id="${id}"]`);
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Marcando...';
  }

  const { data, error } = await supabase.rpc('confirmar_pagamento', { p_pagamento_id: id });

  if (error) {
    console.error('Erro ao confirmar pagamento:', error);
    alert('Não foi possível marcar como recebido agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Recebido';
    }
    return;
  }

  estado.pagamentosPendentes = estado.pagamentosPendentes.filter(p => p.id !== id);

  // Essa pode ter sido a última pendência da sessão — o banco já encerrou
  // ela sozinho na mesma transação (ver supabase/015_encerramento_automatico.sql).
  // Mesmo raciocínio de finalizarFechamento (fechamento manual): limpa o
  // estado local da mesa na hora, sem esperar o Realtime ir e voltar, pra
  // não desenhar por um instante um card de mesa/pedido que já foi encerrado.
  if (data && data.sessao_encerrada) {
    estado.pedidos = estado.pedidos.filter(pedido => String(pedido.mesa) !== String(data.mesa));
    estado.fechamentos = estado.fechamentos.filter(f => String(f.mesa) !== String(data.mesa));
    estado.mesasAtivas = estado.mesasAtivas.filter(s => String(s.mesa) !== String(data.mesa));
    renderizarPedidos();
    mostrarToast(`Mesa ${data.mesa} quitada e encerrada automaticamente.`);
  }

  await renderizarPagamentosPendentes();
  // O card de "Conta Fechada" da mesa e o de "Mesas Ativas" mostram Total/
  // Pago/Falta calculado em cima dos pagamentos — sem isso, ficavam com o
  // valor antigo (como se nada tivesse sido pago) até algo mais disparar um
  // re-render.
  await renderizarFechamentos();
  await renderizarMesasAtivas();
}

pagamentoGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pagamento-card__ok');
  if (!botao) return;
  confirmarRecebimentoPagamento(botao.dataset.id);
});
