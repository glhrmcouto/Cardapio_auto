import { supabase } from '../supabaseClient.js';
import { formatarPreco, escaparTexto, mostrarToast, STATUS_LABEL_PESSOA } from '../shared.js';
import { mesaInput, exigirMesa, tokenMesa } from './mesa.js';
import { sessaoId, tokenSessao, ehErroSessaoEncerrada, mostrarContaFechada } from './sessao.js';
import { clienteId } from './cliente.js';

// ========================================
// CONTA DA MESA (modal com as seções "Minha parte" e "Conta da mesa")
// ========================================
//
// Um único modal, duas seções: "Minha parte" (o que essa pessoa consumiu,
// já com a fração dos itens compartilhados, e o botão pra fechar só a dela —
// RPC fechar_parcial) e "Conta da mesa" (visão geral da sessão: total,
// quanto já foi pago/está aguardando confirmação, saldo restante e o status
// de cada pessoa). Os dois vêm de uma chamada só à RPC conta_da_mesa (ver
// supabase/009_fechamento_parcial.sql), passando o cliente_id pra receber
// também o bloco "minha_parte".

const fecharContaBtn = document.getElementById('fecharContaBtn');
const fecharContaOverlay = document.getElementById('fecharContaOverlay');
const fecharContaModal = document.getElementById('fecharContaModal');
const fecharContaMesaEl = document.getElementById('fecharContaMesa');
const fecharContaStatusEl = document.getElementById('fecharContaStatus');
const fecharContaConteudoEl = document.getElementById('fecharContaConteudo');
const fecharContaClose = document.getElementById('fecharContaClose');
const fecharContaCancelar = document.getElementById('fecharContaCancelar');
const fecharContaConfirmar = document.getElementById('fecharContaConfirmar');

// Minha parte
const minhaParteVazioEl = document.getElementById('minhaParteVazio');
const minhaParteItensEl = document.getElementById('minhaParteItens');
const minhaParteAcaoAbertoEl = document.getElementById('minhaParteAcaoAberto');
const minhaParteAceitaTaxaEl = document.getElementById('minhaParteAceitaTaxa');
const minhaParteTaxaPercentualAbertoEl = document.getElementById('minhaParteTaxaPercentualAberto');
const minhaParteSubtotalAbertoEl = document.getElementById('minhaParteSubtotalAberto');
const minhaParteTaxaAbertoEl = document.getElementById('minhaParteTaxaAberto');
const minhaParteValorAbertoEl = document.getElementById('minhaParteValorAberto');
const fecharMinhaParteBtn = document.getElementById('fecharMinhaParteBtn');
const minhaParteAguardandoEl = document.getElementById('minhaParteAguardando');
const minhaParteSubtotalAguardandoEl = document.getElementById('minhaParteSubtotalAguardando');
const minhaParteTaxaAguardandoEl = document.getElementById('minhaParteTaxaAguardando');
const minhaParteValorAguardandoEl = document.getElementById('minhaParteValorAguardando');
const minhaPartePagaEl = document.getElementById('minhaPartePaga');
const minhaParteSubtotalPagoEl = document.getElementById('minhaParteSubtotalPago');
const minhaParteTaxaPagoEl = document.getElementById('minhaParteTaxaPago');
const minhaParteValorPagoEl = document.getElementById('minhaParteValorPago');

// Conta da mesa
const contaMesaVazioEl = document.getElementById('contaMesaVazio');
const fecharContaItensEl = document.getElementById('fecharContaItens');
const fecharContaSubtotalEl = document.getElementById('fecharContaSubtotal');
const fecharContaTaxaPercentualEl = document.getElementById('fecharContaTaxaPercentual');
const fecharContaTaxaEl = document.getElementById('fecharContaTaxa');
const fecharContaTotalGeralEl = document.getElementById('fecharContaTotalGeral');
const fecharContaPagoEl = document.getElementById('fecharContaPago');
const fecharContaTotalEl = document.getElementById('fecharContaTotal');
const contaPessoasListaEl = document.getElementById('contaPessoasLista');

// Arredonda pro mesmo padrão de 2 casas usado no banco (round(valor, 2)) —
// preview client-side do checkbox "incluir taxa", sem precisar de round-trip
// ao servidor a cada clique.
function arredondar2(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

// Guarda o subtotal em aberto + percentual atual pra recalcular a prévia
// (Subtotal/Serviço/Total) na hora, quando o checkbox de taxa é alternado.
let minhaParteAbertoCache = null;

function atualizarPreviewMinhaParteAberto() {
  if (!minhaParteAbertoCache) return;
  const { subtotal, pct } = minhaParteAbertoCache;
  const taxa = minhaParteAceitaTaxaEl.checked ? arredondar2(subtotal * pct / 100) : 0;

  minhaParteSubtotalAbertoEl.textContent = formatarPreco(subtotal);
  minhaParteTaxaAbertoEl.textContent = formatarPreco(taxa);
  minhaParteValorAbertoEl.textContent = formatarPreco(subtotal + taxa);
}

minhaParteAceitaTaxaEl.addEventListener('change', atualizarPreviewMinhaParteAberto);

// Monta os <li> de "Minha parte": itens diretos + fatias de compartilhados,
// cada um com uma marca "✓ pago" quando já está vinculado a um pagamento.
function montarItensMinhaParte(minhaParte) {
  const diretos = minhaParte.itens_diretos.map(item => `
    <li class="modal-panel__item conta-item${item.pago ? ' conta-item--pago' : ''}">
      <span>${item.quantidade}x ${item.nome}${item.pago ? '<span class="conta-item__tag-pago">✓ pago</span>' : ''}</span>
      <span>${formatarPreco(item.preco * item.quantidade)}</span>
    </li>
  `);
  const compartilhados = minhaParte.itens_compartilhados.map(item => `
    <li class="modal-panel__item conta-item${item.pago ? ' conta-item--pago' : ''}">
      <span>${item.nome} (fração compartilhada)${item.pago ? '<span class="conta-item__tag-pago">✓ pago</span>' : ''}</span>
      <span>${formatarPreco(item.valor)}</span>
    </li>
  `);
  return diretos.concat(compartilhados).join('');
}

function renderizarMinhaParte(minhaParte, percentualTaxa) {
  const semNada = minhaParte.itens_diretos.length === 0 && minhaParte.itens_compartilhados.length === 0;

  minhaParteAcaoAbertoEl.style.display = 'none';
  minhaParteAguardandoEl.style.display = 'none';
  minhaPartePagaEl.style.display = 'none';
  minhaParteAbertoCache = null;

  if (semNada) {
    minhaParteVazioEl.style.display = 'block';
    minhaParteItensEl.innerHTML = '';
    return;
  }

  minhaParteVazioEl.style.display = 'none';
  minhaParteItensEl.innerHTML = montarItensMinhaParte(minhaParte);

  if (minhaParte.status === 'em_aberto') {
    minhaParteTaxaPercentualAbertoEl.textContent = percentualTaxa;
    minhaParteAceitaTaxaEl.checked = true;
    minhaParteAbertoCache = { subtotal: minhaParte.subtotal_em_aberto, pct: percentualTaxa };
    atualizarPreviewMinhaParteAberto();
    minhaParteAcaoAbertoEl.style.display = 'flex';
    fecharMinhaParteBtn.disabled = false;
    fecharMinhaParteBtn.textContent = 'Fechar minha parte';
  } else if (minhaParte.status === 'aguardando') {
    minhaParteSubtotalAguardandoEl.textContent = formatarPreco(minhaParte.subtotal_aguardando);
    minhaParteTaxaAguardandoEl.textContent = formatarPreco(minhaParte.taxa_aguardando);
    minhaParteValorAguardandoEl.textContent = formatarPreco(minhaParte.total_aguardando);
    minhaParteAguardandoEl.style.display = 'block';
  } else {
    minhaParteSubtotalPagoEl.textContent = formatarPreco(minhaParte.subtotal_pago);
    minhaParteTaxaPagoEl.textContent = formatarPreco(minhaParte.taxa_pago);
    minhaParteValorPagoEl.textContent = formatarPreco(minhaParte.total_pago);
    minhaPartePagaEl.style.display = 'block';
  }
}

function renderizarContaDaMesa(conta) {
  if (!conta.itens || conta.itens.length === 0) {
    contaMesaVazioEl.style.display = 'block';
    fecharContaItensEl.innerHTML = '';
  } else {
    contaMesaVazioEl.style.display = 'none';
    fecharContaItensEl.innerHTML = conta.itens.map(item => `
      <li class="modal-panel__item">
        <span>${item.quantidade}x ${item.nome}</span>
        <span>${formatarPreco(item.preco * item.quantidade)}</span>
      </li>
    `).join('');
  }

  fecharContaSubtotalEl.textContent = formatarPreco(conta.subtotal);
  fecharContaTaxaPercentualEl.textContent = conta.taxa_servico_percentual;
  fecharContaTaxaEl.textContent = formatarPreco(conta.taxa_servico);
  fecharContaTotalGeralEl.textContent = formatarPreco(conta.total_geral);
  fecharContaPagoEl.textContent = formatarPreco(conta.total_pago + conta.total_pendente_confirmacao);
  // Saldo restante, nunca o total geral — é o que ainda falta receber da mesa.
  fecharContaTotalEl.textContent = formatarPreco(conta.saldo_restante);

  contaPessoasListaEl.innerHTML = conta.por_pessoa.map(pessoa => `
    <li>
      <div class="conta-pessoas__linha-principal">
        <span>${escaparTexto(pessoa.nome)}<span class="conta-pessoas__status conta-pessoas__status--${pessoa.status}">${STATUS_LABEL_PESSOA[pessoa.status] || pessoa.status}</span></span>
        <span>${formatarPreco(pessoa.valor)}</span>
      </div>
      <div class="conta-pessoas__detalhe">Subtotal ${formatarPreco(pessoa.subtotal)} + Serviço ${formatarPreco(pessoa.taxa_servico)}</div>
    </li>
  `).join('');
}

// Abre o modal na hora (com "consultando...") e preenche assim que a RPC conta_da_mesa
// responder — ela já traz "minha_parte" (passando o cliente_id) e o resumo geral
// da sessão aberta da mesa (ver supabase/010_taxa_servico_configuravel.sql).
async function abrirModalFecharConta(mesa) {
  fecharContaMesaEl.textContent = mesa;
  fecharContaStatusEl.textContent = 'Consultando conta...';
  fecharContaStatusEl.style.display = 'block';
  fecharContaConteudoEl.style.display = 'none';

  fecharContaOverlay.classList.add('is-open');
  fecharContaModal.classList.add('is-open');

  try {
    const { data: conta, error } = await supabase.rpc('conta_da_mesa', {
      p_mesa: Number(mesa),
      p_token: tokenMesa,
      p_cliente_id: clienteId,
      p_token_sessao: tokenSessao,
    });

    if (error) throw error;

    renderizarMinhaParte(conta.minha_parte, conta.taxa_servico_percentual);
    renderizarContaDaMesa(conta);

    fecharContaStatusEl.style.display = 'none';
    fecharContaConteudoEl.style.display = 'block';
  } catch (erro) {
    console.error('Erro ao consultar conta da mesa:', erro);

    if (ehErroSessaoEncerrada(erro)) {
      fecharModalFecharConta();
      mostrarContaFechada(sessaoId);
      return;
    }

    fecharContaConteudoEl.style.display = 'none';
    // erro.message vem da RPC (ver supabase/007_token_conta_mesa.sql) quando é
    // um erro de token/mesa — mensagem já pensada pra ser segura de mostrar.
    fecharContaStatusEl.textContent = erro.message || 'Não foi possível consultar a conta agora. Verifique sua conexão e tente de novo.';
    fecharContaStatusEl.style.display = 'block';
  }
}

function fecharModalFecharConta() {
  fecharContaOverlay.classList.remove('is-open');
  fecharContaModal.classList.remove('is-open');
}

function fecharConta() {
  const mesa = exigirMesa();
  if (!mesa) return;

  abrirModalFecharConta(mesa);
}

// Fecha só a parte dessa pessoa (RPC fechar_parcial) — pede confirmação
// explícita mostrando o valor antes de enviar, depois recarrega o modal pra
// já refletir o novo status ("aguardando confirmação do garçom").
async function fecharMinhaParte() {
  const mesa = mesaInput.value.trim();
  if (!mesa) return;

  const aceitaTaxa = minhaParteAceitaTaxaEl.checked;
  const confirmou = confirm(
    `Fechar sua parte no valor de ${minhaParteValorAbertoEl.textContent}${aceitaTaxa ? '' : ' (sem taxa de serviço)'}?`
  );
  if (!confirmou) return;

  fecharMinhaParteBtn.disabled = true;
  fecharMinhaParteBtn.textContent = 'Fechando...';

  try {
    const { data, error } = await supabase.rpc('fechar_parcial', {
      p_mesa: Number(mesa),
      p_token: tokenMesa,
      p_cliente_id: clienteId,
      p_aceita_taxa: aceitaTaxa,
    });

    if (error) throw error;

    mostrarToast(`Sua parte (${formatarPreco(data.valor_total)}) foi enviada ao balcão. Aguarde o garçom.`);
    await abrirModalFecharConta(mesa);
  } catch (erro) {
    console.error('Erro ao fechar minha parte:', erro);
    mostrarToast(erro.message || 'Não foi possível fechar sua parte agora. Verifique sua conexão e tente de novo.');
    fecharMinhaParteBtn.disabled = false;
    fecharMinhaParteBtn.textContent = 'Fechar minha parte';
  }
}

// Só dispara o pedido de fechamento depois que o cliente confirma no modal.
// pedir_fechamento evita duplicar: se já existir um fechamento pendente pra essa
// mesa, o banco devolve o mesmo registro em vez de criar um novo alerta no balcão.
async function confirmarFecharConta() {
  const mesa = mesaInput.value.trim();

  fecharContaConfirmar.disabled = true;

  try {
    const { error } = await supabase.rpc('pedir_fechamento', {
      p_mesa: Number(mesa),
      p_token: tokenMesa,
      p_token_sessao: tokenSessao,
    });

    if (error) throw error;

    fecharModalFecharConta();
    mostrarToast('Pedido de fechamento enviado! O garçom já foi avisado.');
  } catch (erro) {
    console.error('Erro ao pedir fechamento:', erro);

    if (ehErroSessaoEncerrada(erro)) {
      fecharModalFecharConta();
      mostrarContaFechada(sessaoId);
      return;
    }

    mostrarToast(erro.message || 'Não foi possível enviar o pedido de fechamento. Verifique sua conexão e tente de novo.');
  } finally {
    fecharContaConfirmar.disabled = false;
  }
}

fecharContaBtn.addEventListener('click', fecharConta);
fecharContaClose.addEventListener('click', fecharModalFecharConta);
fecharContaCancelar.addEventListener('click', fecharModalFecharConta);
fecharContaOverlay.addEventListener('click', fecharModalFecharConta);
fecharContaConfirmar.addEventListener('click', confirmarFecharConta);
fecharMinhaParteBtn.addEventListener('click', fecharMinhaParte);

