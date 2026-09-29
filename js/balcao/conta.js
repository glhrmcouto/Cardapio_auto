import { supabase } from '../supabaseClient.js';
import { formatarPreco, escaparTexto, STATUS_LABEL_PESSOA } from '../shared.js';

export function formatarHorario(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

// <ul> de itens (quantidade x nome, subtotal da linha) — mesmo formato nos
// cards de fechamento, de mesas ativas e no histórico.
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

// Tenta encerrar a sessão sem forçar; se a RPC recusar por sobrar saldo (ver
// supabase/009_fechamento_parcial.sql), avisa quanto falta e de quem e pergunta
// se fecha mesmo assim — só então chama de novo com p_forcar=true. Qualquer
// outro erro (ex.: sessão já não existe mais) só é avisado, sem oferecer forçar.
export async function tentarEncerrarSessao(mesa) {
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
