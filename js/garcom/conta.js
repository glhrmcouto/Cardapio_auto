import { supabase } from '../supabaseClientGarcom.js';
import { formatarPreco, escaparTexto, mostrarToast } from '../shared.js';
import { estado } from './estado.js';
import { controleMesas } from './mesas.js';
import { renderizarPedidos } from './pedidos.js';

const contaMesaOverlay = document.getElementById('contaMesaOverlay');
const contaMesaModal = document.getElementById('contaMesaModal');
const contaMesaClose = document.getElementById('contaMesaClose');
const contaMesaNumeroEl = document.getElementById('contaMesaNumero');
const contaMesaVazioEl = document.getElementById('contaMesaVazio');
const contaMesaItensEl = document.getElementById('contaMesaItens');
const contaMesaTotalEl = document.getElementById('contaMesaTotal');
const contaMesaFecharBtn = document.getElementById('contaMesaFecharBtn');

// ========================================================================
// CONTA DA MESA (ver + fechar) — reaproveita conta_da_mesa_balcao e
// encerrar_sessao, as MESMAS RPCs que "Mesas Ativas" em js/balcao.js já
// usa. Nenhuma RPC nova. Disponível pra garcom/balcao/admin (não é
// restrito ao papel garcom — diferente de "Novo pedido" — porque fechar
// conta já era uma ação aberta a qualquer authenticated no balcão hoje).
// ========================================================================

let contaMesaAtual = null; // número da mesa que o modal está mostrando agora
let contaMesaDados = null; // último retorno de conta_da_mesa_balcao pro botão "Fechar conta" usar

function fecharModalContaMesa() {
  contaMesaOverlay.classList.remove('is-open');
  contaMesaModal.classList.remove('is-open');
  contaMesaAtual = null;
  contaMesaDados = null;
}

function renderizarContaMesa(conta) {
  if (conta.itens.length === 0) {
    contaMesaVazioEl.style.display = 'block';
    contaMesaItensEl.innerHTML = '';
  } else {
    contaMesaVazioEl.style.display = 'none';
    contaMesaItensEl.innerHTML = `
      <ul class="pedido-card__itens">
        ${conta.itens.map(item => `
          <li>
            <span>${item.quantidade}x ${escaparTexto(item.nome)}</span>
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  contaMesaTotalEl.textContent = formatarPreco(conta.total_geral);
}

export async function abrirContaMesa(mesaNumero) {
  contaMesaAtual = Number(mesaNumero);
  contaMesaDados = null;
  contaMesaNumeroEl.textContent = mesaNumero;
  contaMesaVazioEl.style.display = 'none';
  contaMesaItensEl.innerHTML = '';
  contaMesaTotalEl.textContent = 'Carregando...';
  contaMesaFecharBtn.disabled = true;

  contaMesaOverlay.classList.add('is-open');
  contaMesaModal.classList.add('is-open');

  const { data, error } = await supabase.rpc('conta_da_mesa_balcao', { p_mesa: contaMesaAtual });

  if (error) {
    console.error('Erro ao consultar conta da mesa:', error);
    contaMesaTotalEl.textContent = '—';
    alert('Não foi possível carregar a conta agora. Verifique sua conexão e tente de novo.');
    return;
  }

  contaMesaDados = data;
  renderizarContaMesa(data);
  contaMesaFecharBtn.disabled = false;
}

// Mesmo fluxo de tentarEncerrarSessao em js/balcao.js: tenta sem forçar;
// se a RPC recusar por sobrar saldo em aberto (supabase/009_fechamento_
// parcial.sql), avisa quanto falta e pergunta se fecha mesmo assim — só
// então chama de novo com p_forcar=true.
async function tentarFecharContaMesa(mesa) {
  const { error } = await supabase.rpc('encerrar_sessao', { p_mesa: Number(mesa), p_forcar: false });

  if (!error) return true;

  if (error.details === 'CONTA_JA_ENCERRADA') {
    // Sessão provavelmente já foi fechada por outro aparelho (ou pelo
    // encerramento automático) enquanto este modal estava aberto.
    alert(error.message);
    return true;
  }

  if (error.message && error.message.startsWith('Ainda falta receber')) {
    const confirmou = confirm(`${error.message}\n\nFechar a conta mesmo assim?`);
    if (!confirmou) return false;

    const { error: erroForcado } = await supabase.rpc('encerrar_sessao', { p_mesa: Number(mesa), p_forcar: true });
    if (erroForcado) {
      console.error('Erro ao forçar fechamento da sessão:', erroForcado);
      alert('Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
      return false;
    }
    return true;
  }

  console.error('Erro ao fechar conta:', error);
  alert(error.message || 'Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
  return false;
}

async function fecharContaMesa() {
  if (!contaMesaAtual || !contaMesaDados) return;

  const confirmou = confirm(
    `Fechar a conta da Mesa ${contaMesaAtual}? Total: ${formatarPreco(contaMesaDados.total_geral)}. Essa ação não pode ser desfeita.`
  );
  if (!confirmou) return;

  contaMesaFecharBtn.disabled = true;
  contaMesaFecharBtn.textContent = 'Fechando...';

  const sucesso = await tentarFecharContaMesa(contaMesaAtual);

  contaMesaFecharBtn.disabled = false;
  contaMesaFecharBtn.textContent = 'Fechar conta';

  if (!sucesso) return;

  const mesaFechada = contaMesaAtual;
  fecharModalContaMesa();

  // Atualização otimista local — o Realtime de "sessoes" (já assinado)
  // cobriria isso de qualquer forma pra OUTROS aparelhos, mas aqui reflete
  // na hora, sem esperar o evento ir e voltar.
  estado.mesasAtivas = estado.mesasAtivas.filter(s => String(s.mesa) !== String(mesaFechada));
  estado.pedidosGarcom = estado.pedidosGarcom.filter(p => String(p.mesa) !== String(mesaFechada));
  controleMesas.atualizarLocal(mesaFechada, 'bloqueada');
  renderizarPedidos();
  mostrarToast(`Conta da Mesa ${mesaFechada} fechada.`);
}

contaMesaFecharBtn.addEventListener('click', fecharContaMesa);
contaMesaClose.addEventListener('click', fecharModalContaMesa);
contaMesaOverlay.addEventListener('click', fecharModalContaMesa);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && contaMesaModal.classList.contains('is-open')) {
    fecharModalContaMesa();
  }
});

