import { supabase } from '../supabaseClient.js';
import { formatarPreco, escaparTexto } from '../shared.js';

export const STATUS_LABEL_PESSOA = { em_aberto: 'Em aberto', aguardando: 'Aguardando', pago: 'Pago' };

export function formatarHorario(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

// <ul> de itens (quantidade x nome, subtotal da linha) — mesmo formato nos
// cards da fila, de fechamento, de mesas ativas e no histórico.
export function htmlListaItens(itens) {
  return `
      <ul class="pedido-card__itens">
        ${itens.map(item => `
          <li>
            <span>${item.quantidade}x ${item.nome}</span>
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
  `;
}

// Total/Pago/Falta da mesa + detalhamento por pessoa (só quando tem mais de
// uma) — usado igual no card de "fechar conta" e no de "Mesas Ativas".
export function htmlResumoConta(conta) {
  return `
      <div class="fechamento-card__saldo">
        <span>Total <strong>${formatarPreco(conta.totalGeral)}</strong> <span class="fechamento-card__saldo-servico">(serviço ${formatarPreco(conta.taxaServico)})</span></span>
        <span>Pago <strong>${formatarPreco(conta.totalPago)}</strong></span>
        <span class="falta">Falta <strong>${formatarPreco(conta.saldoRestante)}</strong></span>
      </div>
      ${conta.porPessoa.length > 1 ? `
        <div class="fechamento-card__pessoas">
          <div class="fechamento-card__pessoas-titulo">Por pessoa</div>
          ${conta.porPessoa.map(pessoa => `
            <div class="fechamento-card__linha">
              <span>${escaparTexto(pessoa.nome)}<span class="fechamento-card__pessoa-status fechamento-card__pessoa-status--${pessoa.status}">${STATUS_LABEL_PESSOA[pessoa.status] || pessoa.status}</span></span>
              <span>${formatarPreco(pessoa.valor)}</span>
            </div>
            <div class="fechamento-card__pessoa-detalhe">Subtotal ${formatarPreco(pessoa.subtotal)} + Serviço ${formatarPreco(pessoa.taxa_servico)}</div>
          `).join('')}
        </div>
      ` : ''}
  `;
}

// Itens + totais (geral/pago/aguardando confirmação/saldo restante) + resumo
// por pessoa da SESSÃO ABERTA da mesa (rateio dos compartilhados e status de
// pagamento já aplicados no banco). Usa a RPC conta_da_mesa_balcao (ver
// supabase/009_fechamento_parcial.sql) em vez de consultar a tabela direto,
// porque essa lógica é melhor mantida num só lugar (o banco), não duplicada
// aqui e na RPC do cliente (conta_da_mesa).
export async function obterContaAtivaDaMesa(mesa) {
  const { data, error } = await supabase.rpc('conta_da_mesa_balcao', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao consultar itens da mesa:', error);
    return { itens: [], subtotal: 0, taxaServico: 0, totalGeral: 0, totalPago: 0, totalPendente: 0, saldoRestante: 0, porPessoa: [] };
  }

  return {
    itens: data.itens,
    subtotal: data.subtotal,
    taxaServico: data.taxa_servico,
    totalGeral: data.total_geral,
    totalPago: data.total_pago,
    totalPendente: data.total_pendente_confirmacao,
    saldoRestante: data.saldo_restante,
    porPessoa: data.por_pessoa,
  };
}
