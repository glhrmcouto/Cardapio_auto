import { supabase } from '../supabaseClient.js';
import { escaparAtributo, montarUrlMesa } from '../shared.js';
import { mostrarFeedback } from './feedback.js';

const mesasCarregandoEl = document.getElementById('mesasCarregando');
const mesasErroEl = document.getElementById('mesasErro');
const mesasTentarBtn = document.getElementById('mesasTentar');
const mesasContainer = document.getElementById('mesasContainer');
const novaMesaForm = document.getElementById('novaMesaForm');
const novaMesaNumeroEl = document.getElementById('novaMesaNumero');

// ========================================
// MESAS (token do QR code — ver supabase/005_seguranca.sql)
// ========================================
//
// Cada mesa tem um token secreto que autoriza criar_pedido/pedir_fechamento
// pra ela; sem ele (ou com o número errado), a RPC recusa o pedido no banco
// mesmo que a mesa exista de verdade. Esse painel é o único lugar que expõe
// o token em texto — faz sentido, já que só admin autenticado chega aqui.

let todasMesas = [];

export async function carregarMesas() {
  mesasCarregandoEl.style.display = 'block';
  mesasErroEl.style.display = 'none';
  mesasContainer.innerHTML = '';

  try {
    const { data, error } = await supabase
      .from('mesas')
      .select('numero, token, ativa')
      .order('numero');

    if (error) throw error;

    todasMesas = data;
    renderizarMesas();
    mesasCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar mesas:', erro);
    mesasCarregandoEl.style.display = 'none';
    mesasErroEl.style.display = 'block';
  }
}

mesasTentarBtn.addEventListener('click', carregarMesas);

function renderizarMesaCard(mesa) {
  const statusClasse = mesa.ativa ? 'admin-produto-card__status--ativo' : 'admin-produto-card__status--inativo';
  const statusTexto = mesa.ativa ? 'Ativa' : 'Inativa';
  const textoAlternar = mesa.ativa ? 'Desativar' : 'Ativar';

  return `
    <div class="admin-produto-card admin-mesa-card ${mesa.ativa ? '' : 'admin-produto-card--inativo'}" data-numero="${mesa.numero}">
      <div class="admin-produto-card__topo">
        <span class="admin-mesa-card__numero">Mesa ${mesa.numero}</span>
        <span class="admin-produto-card__status ${statusClasse}">${statusTexto}</span>
      </div>

      <div class="admin-produto-card__campo">
        <label>Link do QR code</label>
        <input type="text" class="admin-produto-card__input admin-mesa-card__url" value="${escaparAtributo(montarUrlMesa(mesa))}" readonly>
      </div>

      <div class="admin-produto-card__acoes">
        <button type="button" class="btn btn--secondary" data-acao="copiar-link">Copiar link</button>
        <button type="button" class="btn btn--secondary" data-acao="alternar-ativa">${textoAlternar}</button>
        <button type="button" class="btn btn--secondary" data-acao="regerar-token">Regerar token</button>
      </div>
      <p class="admin-produto-card__feedback" role="status"></p>
    </div>
  `;
}

function renderizarMesas() {
  if (todasMesas.length === 0) {
    mesasContainer.innerHTML = '<p class="cardapio-status">Nenhuma mesa cadastrada ainda — adicione uma acima.</p>';
    return;
  }
  mesasContainer.innerHTML = todasMesas.map(renderizarMesaCard).join('');
}

async function copiarLinkMesa(mesa, card) {
  const url = montarUrlMesa(mesa);
  try {
    await navigator.clipboard.writeText(url);
    mostrarFeedback(card, 'Link copiado!', 'sucesso');
  } catch (erro) {
    console.error('Erro ao copiar link da mesa:', erro);
    const input = card.querySelector('.admin-mesa-card__url');
    input.select();
    mostrarFeedback(card, 'Não copiou sozinho — o link já está selecionado, copie manualmente (Ctrl+C).', 'erro');
  }
}

async function alternarAtivaMesa(numero, card) {
  const mesa = todasMesas.find(m => m.numero === numero);
  if (!mesa) return;

  const novoValor = !mesa.ativa;
  const botao = card.querySelector('[data-acao="alternar-ativa"]');
  botao.disabled = true;

  const { error } = await supabase.from('mesas').update({ ativa: novoValor }).eq('numero', numero);

  if (error) {
    console.error('Erro ao ativar/desativar mesa:', error);
    botao.disabled = false;
    mostrarFeedback(card, 'Não foi possível atualizar o status. Tente de novo.', 'erro');
    return;
  }

  mesa.ativa = novoValor;
  renderizarMesas();
  const cardNovo = mesasContainer.querySelector(`.admin-mesa-card[data-numero="${numero}"]`);
  if (cardNovo) mostrarFeedback(cardNovo, novoValor ? 'Mesa ativada.' : 'Mesa desativada.', 'sucesso');
}

// Gera um token novo pra mesa (RPC regenerar_token_mesa, restrita a admin —
// ver 005_seguranca.sql). O QR code impresso com o token antigo para de
// funcionar na hora; é preciso reimprimir com o link novo mostrado aqui.
async function regerarTokenMesa(numero, card) {
  const confirmou = confirm(`Gerar um novo link pra mesa ${numero}? O QR code impresso hoje vai parar de funcionar assim que você confirmar.`);
  if (!confirmou) return;

  const botao = card.querySelector('[data-acao="regerar-token"]');
  botao.disabled = true;
  botao.textContent = 'Gerando...';

  const { data, error } = await supabase.rpc('regenerar_token_mesa', { p_numero: numero });

  botao.disabled = false;
  botao.textContent = 'Regerar token';

  if (error) {
    console.error('Erro ao regerar token da mesa:', error);
    mostrarFeedback(card, 'Não foi possível gerar um novo link agora. Tente de novo.', 'erro');
    return;
  }

  const mesaLocal = todasMesas.find(m => m.numero === numero);
  Object.assign(mesaLocal, data);
  renderizarMesas();
  const cardNovo = mesasContainer.querySelector(`.admin-mesa-card[data-numero="${numero}"]`);
  if (cardNovo) mostrarFeedback(cardNovo, 'Novo link gerado! Reimprima o QR code dessa mesa.', 'sucesso');
}

mesasContainer.addEventListener('click', (event) => {
  const botao = event.target.closest('button[data-acao]');
  if (!botao) return;

  const card = botao.closest('.admin-mesa-card');
  const numero = Number(card.dataset.numero);
  const mesa = todasMesas.find(m => m.numero === numero);
  const acao = botao.dataset.acao;

  if (acao === 'copiar-link') copiarLinkMesa(mesa, card);
  else if (acao === 'alternar-ativa') alternarAtivaMesa(numero, card);
  else if (acao === 'regerar-token') regerarTokenMesa(numero, card);
});

novaMesaForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const numero = parseInt(novaMesaNumeroEl.value, 10);
  if (!Number.isFinite(numero) || numero <= 0) return;

  const botaoAdicionar = novaMesaForm.querySelector('button[type="submit"]');
  botaoAdicionar.disabled = true;

  // O token nasce sozinho no banco (DEFAULT da coluna, ver 005_seguranca.sql)
  // — nunca gerado aqui no navegador.
  const { data: mesaNova, error } = await supabase
    .from('mesas')
    .insert({ numero })
    .select('numero, token, ativa')
    .single();

  botaoAdicionar.disabled = false;

  if (error) {
    console.error('Erro ao adicionar mesa:', error);
    alert(error.code === '23505' ? `A mesa ${numero} já existe.` : 'Não foi possível adicionar a mesa agora. Verifique sua conexão e tente de novo.');
    return;
  }

  novaMesaForm.reset();
  todasMesas.push(mesaNova);
  todasMesas.sort((a, b) => a.numero - b.numero);
  renderizarMesas();
});
