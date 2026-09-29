// ========================================================================
// TELA DO GARÇOM — painel mobile-first pro celular do garçom no salão
// ========================================================================
//
// ETAPA 1: login + controle de acesso por papel + esqueleto das abas
// (Mesas/Pedidos).
// ETAPA 2: aba Mesas — lista com status, ações por mesa e em massa, tudo
// reaproveitando as MESMAS RPCs já usadas em balcao.js (nenhuma RPC nova
// foi criada nessa etapa).
// ETAPA 3: aba Pedidos — lista os pedidos pendentes (sessões abertas) com
// itens/horário/status e o botão "Marcar entregue", igual balcao.js só que
// enxuto pro celular (sem o botão de remover item — esse fica só no
// balcão). UPDATE direto em "pedidos" via RLS pedidos_update_authenticated,
// mesma RPC-menos-RPC que o balcão já usa.
// ETAPA 4: "Novo pedido" — o garçom lança pedido numa mesa SEM QR code,
// pra cliente sem celular. Precisou de uma RPC nova (lancar_pedido_garcom,
// ver supabase/024_lancar_pedido_garcom.sql), já que criar_pedido (o
// caminho do cliente) autoriza por TOKEN da mesa, e o garçom não tem —
// nem deve ter — acesso a esse token. A RPC nova autoriza por PAPEL em vez
// de token, e por pedido explícito só aceita papel 'garcom' (nem balcao
// nem admin) — ver _exigir_garcom() no SQL e papelUsuario/renderizarMesas
// aqui (o botão só aparece pra quem tem esse papel; a RPC recusa de
// qualquer forma se alguém tentar burlar via console).
// ETAPA 5 (esta): "Ver conta"/"Fechar conta" — reaproveita
// conta_da_mesa_balcao e encerrar_sessao, as MESMAS RPCs que "Mesas
// Ativas" em balcao.js já usa há muito tempo. Nenhuma RPC nova. Diferente
// de "Novo pedido", esta ação fica aberta pra garcom/balcao/admin — não é
// exclusiva de papel, porque fechar conta já era uma ação de qualquer
// authenticated no balcão antes deste arquivo existir.
//
// Login: sessão autenticada (Supabase Auth, igual balcao.html) — mas,
// diferente de balcao.html (que aceita QUALQUER conta autenticada), aqui
// TAMBÉM exige papel 'garcom', 'balcao' ou 'admin' em "perfis" (ver
// supabase/023_papel_garcom.sql). Login sem esse papel é barrado e
// deslogado — mesmo padrão de admin.js/relatorios.js pro papel admin.
//
// As RPCs que esta tela chama (ativar_mesa, desativar_mesa, liberar_mesa,
// liberar_todas_mesas, bloquear_todas_mesas, encerrar_sessao, e o UPDATE de
// status de entrega via RLS pedidos_update_authenticated) já são liberadas
// pra QUALQUER conta authenticated, sem checagem de papel — um garçom
// logado já consegue chamar todas elas, sem nenhuma RPC nova. A exceção é
// lancar_pedido_garcom, que exige especificamente o papel garcom (ver
// ETAPA 4 acima) — nenhuma outra ação desta tela tem essa restrição extra.
//
// REALTIME DA ABA MESAS — leia antes de mexer: "mesas" (a tabela) NÃO está
// publicada no Realtime, de propósito (o token é secreto — ver comentário
// no fim de supabase/019_bloqueio_mesa.sql; um evento Realtime manda a
// linha INTEIRA). Isso já valia pro balcão antes deste arquivo existir: se
// UM balcão/garçom chama liberar_mesa/ativar_mesa/desativar_mesa/
// liberar_todas_mesas/bloquear_todas_mesas, NENHUM outro aparelho é
// avisado na hora — só quando "sessoes" muda (fechamento total, que já
// está no Realtime desde 012_realtime_sessoes.sql) é que os outros
// aparelhos ficam sabendo, e mesmo assim só descobrem que a mesa foi
// BLOQUEADA (efeito colateral de _bloquear_mesa), nunca liberada/ativada/
// desativada por outro aparelho. Pra cobrir esse resto sem publicar
// "mesas" (o que vazaria token), esta aba faz um polling leve (ver
// INTERVALO_POLL_MESAS) enquanto a página está aberta — mesma ideia da
// tela do cliente fazendo polling de status_da_mesa (ver mostrarMesaBloqueada
// em js/script.js), só que aqui é a lista inteira via listar_mesas_balcao.

// Cliente PRÓPRIO desta tela (não o de admin/balcão/mesas/relatórios) —
// ver js/supabaseClientGarcom.js pro porquê: sem isso, logar aqui e em
// balcao.html/admin.html ao mesmo tempo (mesmo navegador) faz um login
// derrubar o outro, porque os dois dividiriam a mesma sessão salva no
// localStorage.
import { supabase } from './supabaseClientGarcom.js';
import { configurarLogin } from './auth.js';
import { formatarPreco, escaparTexto, mostrarToast, LABEL_CATEGORIA, ORDEM_CATEGORIAS } from './shared.js';


const abaMesas = document.getElementById('abaMesas');
const abaPedidos = document.getElementById('abaPedidos');
const tabMesasBtn = document.getElementById('tabMesasBtn');
const tabPedidosBtn = document.getElementById('tabPedidosBtn');


const mesasCarregandoEl = document.getElementById('mesasCarregando');
const mesasErroEl = document.getElementById('mesasErro');
const mesasTentarBtn = document.getElementById('mesasTentar');
const mesasVazioEl = document.getElementById('mesasVazio');
const mesasGrid = document.getElementById('mesasGrid');
const liberarTodasBtn = document.getElementById('liberarTodasBtn');
const bloquearTodasBtn = document.getElementById('bloquearTodasBtn');

const pedidosCarregandoEl = document.getElementById('pedidosCarregando');
const pedidosErroEl = document.getElementById('pedidosErro');
const pedidosTentarBtn = document.getElementById('pedidosTentar');
const pedidosVazioEl = document.getElementById('pedidosVazio');
const pedidosGrid = document.getElementById('pedidosGrid');
const pedidosBadgeEl = document.getElementById('pedidosBadge');

const novoPedidoOverlay = document.getElementById('novoPedidoOverlay');
const novoPedidoModal = document.getElementById('novoPedidoModal');
const novoPedidoClose = document.getElementById('novoPedidoClose');
const novoPedidoMesaNumeroEl = document.getElementById('novoPedidoMesaNumero');
const novoPedidoNomeInput = document.getElementById('novoPedidoNome');
const novoPedidoItensEl = document.getElementById('novoPedidoItens');
const novoPedidoTotalEl = document.getElementById('novoPedidoTotal');
const novoPedidoLancarBtn = document.getElementById('novoPedidoLancarBtn');

const contaMesaOverlay = document.getElementById('contaMesaOverlay');
const contaMesaModal = document.getElementById('contaMesaModal');
const contaMesaClose = document.getElementById('contaMesaClose');
const contaMesaNumeroEl = document.getElementById('contaMesaNumero');
const contaMesaVazioEl = document.getElementById('contaMesaVazio');
const contaMesaItensEl = document.getElementById('contaMesaItens');
const contaMesaTotalEl = document.getElementById('contaMesaTotal');
const contaMesaFecharBtn = document.getElementById('contaMesaFecharBtn');

// Papel de quem logou (garcom, balcao ou admin), guardado pra decidir, na
// hora de desenhar os cards de mesa, se mostra o botão "Novo pedido" — essa
// ação (lançar pedido sem QR) é restrita ao papel garcom mesmo (nem balcao
// nem admin, ver supabase/024_lancar_pedido_garcom.sql e _exigir_garcom()
// lá dentro). Isso aqui é só UX (esconder um botão que ia dar erro); a
// restrição de verdade é sempre no banco, dentro da RPC.
let papelUsuario = null;

// ========================================================================
// ABAS (Mesas / Pedidos)
// ========================================================================
// Troca simples de visibilidade — sem router, sem estado na URL (a tela
// fica numa aba só do celular, recarregar sempre volta pra "Mesas").

const ABAS = {
  mesas: { secao: abaMesas, botao: tabMesasBtn },
  pedidos: { secao: abaPedidos, botao: tabPedidosBtn },
};

function mostrarAba(nome) {
  for (const [chave, { secao, botao }] of Object.entries(ABAS)) {
    const ativa = chave === nome;
    secao.hidden = !ativa;
    botao.classList.toggle('is-ativo', ativa);
    botao.setAttribute('aria-current', ativa ? 'page' : 'false');
  }
}

tabMesasBtn.addEventListener('click', () => mostrarAba('mesas'));
tabPedidosBtn.addEventListener('click', () => mostrarAba('pedidos'));

// ========================================================================
// TOAST (aviso discreto — mesmo padrão de js/balcao.js)
// ========================================================================

// ========================================================================
// ABA MESAS — lista, ações por mesa e em massa (reaproveita listar_mesas_balcao,
// liberar_mesa, ativar_mesa, desativar_mesa, liberar_todas_mesas e
// bloquear_todas_mesas, todas já existentes; ver comentário de REALTIME DA
// ABA MESAS no topo do arquivo pra como isso fica sincronizado com o balcão)
// ========================================================================

let mesasControle = []; // TODAS as mesas ({numero, status_mesa, ativa}) — ver listar_mesas_balcao
let mesasAtivas = [];   // sessões com status 'aberta' — uma por mesa ocupada agora

// Lista TODAS as mesas via RPC — nunca consulta a tabela "mesas" direto: RLS
// restringe o SELECT direto a admin (o token é secreto, ver 005_seguranca.sql)
// e garcom.html aceita garcom/balcao/admin. listar_mesas_balcao (ver
// supabase/019_bloqueio_mesa.sql) devolve só número/status_mesa/ativa,
// nunca o token.
async function carregarMesasControle() {
  const { data, error } = await supabase.rpc('listar_mesas_balcao');
  if (error) throw error;
  mesasControle = data;
}

// Toda mesa com sessão aberta agora (ver supabase/008_sessoes.sql) — usada
// só pro selo "Sessão aberta" no card; a decisão de pular mesa no bloqueio
// em massa é feita no banco (bloquear_todas_mesas), não aqui.
async function carregarMesasAtivas() {
  const { data, error } = await supabase
    .from('sessoes')
    .select('id, mesa')
    .eq('status', 'aberta');

  if (error) throw error;
  mesasAtivas = data;
}

async function carregarMesasIniciais() {
  mesasCarregandoEl.style.display = 'block';
  mesasErroEl.style.display = 'none';
  mesasGrid.innerHTML = '';

  try {
    await Promise.all([carregarMesasControle(), carregarMesasAtivas()]);
    renderizarMesas();
    mesasCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar mesas:', erro);
    mesasCarregandoEl.style.display = 'none';
    mesasErroEl.style.display = 'block';
  }
}

mesasTentarBtn.addEventListener('click', carregarMesasIniciais);

// Mesmo componente visual de .controle-mesa-card (balcao.css) — mesa
// inativa tem card simplificado (só "Ativar mesa"); mesa ativa mostra
// liberada/bloqueada, selo de sessão aberta e os botões cabíveis.
function renderizarMesas() {
  if (mesasControle.length === 0) {
    mesasVazioEl.style.display = 'block';
    mesasGrid.innerHTML = '';
    return;
  }

  mesasVazioEl.style.display = 'none';

  mesasGrid.innerHTML = mesasControle.map(mesa => {
    if (!mesa.ativa) {
      return `
      <div class="controle-mesa-card controle-mesa-card--inativa" data-mesa="${mesa.numero}">
        <div class="controle-mesa-card__mesa">Mesa ${mesa.numero}</div>
        <span class="controle-mesa-card__status controle-mesa-card__status--inativa">Inativa</span>
        <button type="button" class="btn btn--secondary controle-mesa-card__ativar" data-mesa="${mesa.numero}">Ativar mesa</button>
      </div>
    `;
    }

    const bloqueada = mesa.status_mesa === 'bloqueada';
    const temSessaoAberta = mesasAtivas.some(s => String(s.mesa) === String(mesa.numero));

    return `
    <div class="controle-mesa-card${bloqueada ? ' controle-mesa-card--bloqueada' : ''}" data-mesa="${mesa.numero}">
      <div class="controle-mesa-card__mesa">Mesa ${mesa.numero}</div>
      <span class="controle-mesa-card__status controle-mesa-card__status--${mesa.status_mesa}">${bloqueada ? 'Bloqueada' : 'Liberada'}</span>
      ${temSessaoAberta ? '<span class="controle-mesa-card__sessao">Sessão aberta</span>' : ''}
      ${papelUsuario === 'garcom' ? `<button type="button" class="btn btn--primary controle-mesa-card__novo-pedido" data-mesa="${mesa.numero}">Novo pedido</button>` : ''}
      ${temSessaoAberta ? `<button type="button" class="btn btn--secondary controle-mesa-card__ver-conta" data-mesa="${mesa.numero}">Ver conta</button>` : ''}
      ${bloqueada ? `<button type="button" class="btn btn--secondary controle-mesa-card__liberar" data-mesa="${mesa.numero}">Liberar mesa</button>` : ''}
      <button type="button" class="btn btn--secondary controle-mesa-card__desativar" data-mesa="${mesa.numero}">Desativar mesa</button>
    </div>
  `;
  }).join('');
}

function atualizarMesaControleLocal(mesa, novoStatus) {
  const entrada = mesasControle.find(m => String(m.numero) === String(mesa));
  if (entrada) entrada.status_mesa = novoStatus;
  renderizarMesas();
}

async function liberarMesa(mesa, botao) {
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Liberando...';
  }

  const { error } = await supabase.rpc('liberar_mesa', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao liberar mesa:', error);
    alert('Não foi possível liberar a mesa agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Liberar mesa';
    }
    return;
  }

  atualizarMesaControleLocal(mesa, 'liberada');
}

async function desativarMesa(mesa, botao) {
  const confirmou = confirm(`Desativar a mesa ${mesa}? Ela some do cardápio pro cliente até alguém reativar.`);
  if (!confirmou) return;

  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Desativando...';
  }

  const { error } = await supabase.rpc('desativar_mesa', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao desativar mesa:', error);
    alert('Não foi possível desativar a mesa agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Desativar mesa';
    }
    return;
  }

  const entrada = mesasControle.find(m => String(m.numero) === String(mesa));
  if (entrada) entrada.ativa = false;
  renderizarMesas();
}

async function ativarMesa(mesa, botao) {
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Ativando...';
  }

  const { error } = await supabase.rpc('ativar_mesa', { p_mesa: Number(mesa) });

  if (error) {
    console.error('Erro ao ativar mesa:', error);
    alert('Não foi possível ativar a mesa agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Ativar mesa';
    }
    return;
  }

  const entrada = mesasControle.find(m => String(m.numero) === String(mesa));
  if (entrada) entrada.ativa = true;
  renderizarMesas();
}

mesasGrid.addEventListener('click', (event) => {
  const botaoLiberar = event.target.closest('.controle-mesa-card__liberar');
  if (botaoLiberar) {
    liberarMesa(botaoLiberar.dataset.mesa, botaoLiberar);
    return;
  }

  const botaoDesativar = event.target.closest('.controle-mesa-card__desativar');
  if (botaoDesativar) {
    desativarMesa(botaoDesativar.dataset.mesa, botaoDesativar);
    return;
  }

  const botaoAtivar = event.target.closest('.controle-mesa-card__ativar');
  if (botaoAtivar) {
    ativarMesa(botaoAtivar.dataset.mesa, botaoAtivar);
    return;
  }

  const botaoNovoPedido = event.target.closest('.controle-mesa-card__novo-pedido');
  if (botaoNovoPedido) {
    abrirNovoPedido(botaoNovoPedido.dataset.mesa, botaoNovoPedido);
    return;
  }

  const botaoVerConta = event.target.closest('.controle-mesa-card__ver-conta');
  if (botaoVerConta) {
    abrirContaMesa(botaoVerConta.dataset.mesa);
  }
});

// ========================================================================
// AÇÕES EM MASSA — mesmas RPCs de supabase/022_mesas_em_massa.sql já
// usadas no balcão (liberar_todas_mesas, bloquear_todas_mesas)
// ========================================================================
//
// Recarrega listar_mesas_balcao inteira depois de qualquer uma das duas,
// em vez de tentar adivinhar localmente quem mudou — as duas RPCs mexem em
// várias linhas de uma vez.

async function liberarTodasMesas() {
  const confirmou = confirm('Liberar todas as mesas para pedido?');
  if (!confirmou) return;

  liberarTodasBtn.disabled = true;

  const { data: qtd, error } = await supabase.rpc('liberar_todas_mesas');

  liberarTodasBtn.disabled = false;

  if (error) {
    console.error('Erro ao liberar todas as mesas:', error);
    alert('Não foi possível liberar as mesas agora. Verifique sua conexão e tente de novo.');
    return;
  }

  try {
    await carregarMesasControle();
  } catch (erro) {
    console.error('Erro ao recarregar mesas depois de liberar todas:', erro);
  }
  renderizarMesas();
  mostrarToast(`${qtd} ${qtd === 1 ? 'mesa liberada' : 'mesas liberadas'}.`);
}

// Chama bloquear_todas_mesas primeiro sem forçar; se sobrar mesa pulada por
// ter conta aberta, avisa e só bloqueia essas também com uma SEGUNDA
// confirmação explícita (p_forcar=true) — nunca interrompe conta em
// andamento sem o operador saber exatamente o que está fazendo.
async function bloquearTodasMesas() {
  const confirmou = confirm('Bloquear todas as mesas?');
  if (!confirmou) return;

  bloquearTodasBtn.disabled = true;

  const { data: resultado, error } = await supabase.rpc('bloquear_todas_mesas', { p_forcar: false });

  if (error) {
    console.error('Erro ao bloquear todas as mesas:', error);
    bloquearTodasBtn.disabled = false;
    alert('Não foi possível bloquear as mesas agora. Verifique sua conexão e tente de novo.');
    return;
  }

  try {
    await carregarMesasControle();
  } catch (erro) {
    console.error('Erro ao recarregar mesas depois de bloquear todas:', erro);
  }
  renderizarMesas();

  const { bloqueadas, puladas } = resultado;

  if (puladas === 0) {
    bloquearTodasBtn.disabled = false;
    mostrarToast(`${bloqueadas} ${bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'}.`);
    return;
  }

  const forcar = confirm(
    `${bloqueadas} ${bloqueadas === 1 ? 'mesa foi bloqueada' : 'mesas foram bloqueadas'}. ` +
    `${puladas} ${puladas === 1 ? 'mesa tem' : 'mesas têm'} conta aberta e NÃO ${puladas === 1 ? 'foi bloqueada' : 'foram bloqueadas'}. ` +
    'Deseja bloquear essas também? (isso interrompe contas em andamento)'
  );

  if (!forcar) {
    bloquearTodasBtn.disabled = false;
    mostrarToast(`${bloqueadas} ${bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'} — ${puladas} com conta aberta não ${puladas === 1 ? 'foi mexida' : 'foram mexidas'}.`);
    return;
  }

  const { data: resultadoForcado, error: erroForcado } = await supabase.rpc('bloquear_todas_mesas', { p_forcar: true });

  bloquearTodasBtn.disabled = false;

  if (erroForcado) {
    console.error('Erro ao forçar bloqueio de todas as mesas:', erroForcado);
    alert('Não foi possível bloquear as mesas restantes agora. Verifique sua conexão e tente de novo.');
    return;
  }

  try {
    await carregarMesasControle();
  } catch (erro) {
    console.error('Erro ao recarregar mesas depois de forçar bloquear todas:', erro);
  }
  renderizarMesas();
  mostrarToast(`${resultadoForcado.bloqueadas} ${resultadoForcado.bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'} (incluindo com conta aberta).`);
}

liberarTodasBtn.addEventListener('click', liberarTodasMesas);
bloquearTodasBtn.addEventListener('click', bloquearTodasMesas);

// ========================================================================
// NOVO PEDIDO (lançado pelo garçom, sem QR code) — ver supabase/
// 024_lancar_pedido_garcom.sql. Botão só aparece pra papelUsuario==='garcom'
// (renderizarMesas acima); a RPC também restringe por conta própria, então
// mesmo alguém forçando a chamada via console não passa sem esse papel.
// ========================================================================

let produtosCardapio = [];   // [{id, nome, preco, categoria}] — só ativo=true
let produtosCarregados = false;
let mesaNovoPedido = null;   // número da mesa que o modal está editando agora
let carrinhoNovoPedido = {}; // { [produto_id]: quantidade }, só entradas > 0

// Cardápio é carregado uma vez só (produtos raramente mudam durante o
// serviço) e reaproveitado em toda abertura do modal depois da primeira.
// Precisa da policy produtos_select_ativos_authenticated (024) — sem ela,
// RLS devolve 0 linhas em silêncio pra qualquer authenticated sem papel
// admin.
async function garantirProdutosCarregados() {
  if (produtosCarregados) return;

  const { data, error } = await supabase
    .from('produtos')
    .select('id, nome, preco, categoria')
    .eq('ativo', true)
    .order('categoria')
    .order('ordem');

  if (error) throw error;

  produtosCardapio = data;
  produtosCarregados = true;
}

// Se a mesa estiver bloqueada, confirma com o garçom e libera ANTES de
// abrir o cardápio — ele já está vendo que tem gente sentada ali de
// verdade (é exatamente por isso que está lançando o pedido).
async function abrirNovoPedido(mesaNumero, botao) {
  const mesa = mesasControle.find(m => String(m.numero) === String(mesaNumero));
  if (!mesa) return;

  if (mesa.status_mesa === 'bloqueada') {
    const confirmou = confirm(`Mesa ${mesaNumero} está bloqueada. Liberar e continuar com o pedido?`);
    if (!confirmou) return;

    if (botao) {
      botao.disabled = true;
      botao.textContent = 'Liberando...';
    }

    const { error } = await supabase.rpc('liberar_mesa', { p_mesa: Number(mesaNumero) });

    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Novo pedido';
    }

    if (error) {
      console.error('Erro ao liberar mesa antes do pedido:', error);
      alert('Não foi possível liberar a mesa agora. Tente de novo.');
      return;
    }

    atualizarMesaControleLocal(mesaNumero, 'liberada');
  }

  try {
    await garantirProdutosCarregados();
  } catch (erro) {
    console.error('Erro ao carregar cardápio pro novo pedido:', erro);
    alert('Não foi possível carregar o cardápio agora. Verifique sua conexão e tente de novo.');
    return;
  }

  mesaNovoPedido = Number(mesaNumero);
  carrinhoNovoPedido = {};
  novoPedidoMesaNumeroEl.textContent = mesaNumero;
  novoPedidoNomeInput.value = '';
  renderizarProdutosNovoPedido();
  atualizarTotalNovoPedido();

  novoPedidoOverlay.classList.add('is-open');
  novoPedidoModal.classList.add('is-open');
}

function fecharNovoPedido() {
  novoPedidoOverlay.classList.remove('is-open');
  novoPedidoModal.classList.remove('is-open');
}

function renderizarLinhaProdutoNovoPedido(produto) {
  const qtd = carrinhoNovoPedido[produto.id] || 0;
  return `
    <div class="np-item">
      <div class="np-item__info">
        <span class="np-item__nome">${escaparTexto(produto.nome)}</span>
        <span class="np-item__preco">${formatarPreco(produto.preco)}</span>
      </div>
      <div class="np-item__qtd">
        <button type="button" class="np-item__botao" data-acao="menos" data-produto="${produto.id}" ${qtd === 0 ? 'disabled' : ''}>−</button>
        <span class="np-item__valor" data-qtd-produto="${produto.id}">${qtd}</span>
        <button type="button" class="np-item__botao" data-acao="mais" data-produto="${produto.id}">+</button>
      </div>
    </div>
  `;
}

function renderizarProdutosNovoPedido() {
  const grupos = {};
  ORDEM_CATEGORIAS.forEach(categoria => { grupos[categoria] = []; });
  produtosCardapio.forEach(produto => {
    if (!grupos[produto.categoria]) grupos[produto.categoria] = [];
    grupos[produto.categoria].push(produto);
  });

  novoPedidoItensEl.innerHTML = ORDEM_CATEGORIAS
    .filter(categoria => grupos[categoria] && grupos[categoria].length > 0)
    .map(categoria => `
      <div class="np-categoria">
        <h3 class="np-categoria__titulo">${LABEL_CATEGORIA[categoria] || categoria}</h3>
        ${grupos[categoria].map(renderizarLinhaProdutoNovoPedido).join('')}
      </div>
    `).join('');
}

// Atualiza só o número (não redesenha a lista toda) — mantém o scroll e a
// posição do dedo do garçom estáveis enquanto ele toca +/- várias vezes.
function alterarQuantidadeNovoPedido(produtoId, delta) {
  const atual = carrinhoNovoPedido[produtoId] || 0;
  const novo = Math.max(0, Math.min(50, atual + delta));

  if (novo === 0) delete carrinhoNovoPedido[produtoId];
  else carrinhoNovoPedido[produtoId] = novo;

  const valorEl = novoPedidoItensEl.querySelector(`[data-qtd-produto="${produtoId}"]`);
  if (valorEl) valorEl.textContent = novo;

  const botaoMenos = novoPedidoItensEl.querySelector(`.np-item__botao[data-acao="menos"][data-produto="${produtoId}"]`);
  if (botaoMenos) botaoMenos.disabled = novo === 0;

  atualizarTotalNovoPedido();
}

function atualizarTotalNovoPedido() {
  let total = 0;
  let totalItens = 0;

  for (const [produtoId, quantidade] of Object.entries(carrinhoNovoPedido)) {
    const produto = produtosCardapio.find(p => String(p.id) === produtoId);
    if (produto) total += produto.preco * quantidade;
    totalItens += quantidade;
  }

  novoPedidoTotalEl.textContent = formatarPreco(total);
  novoPedidoLancarBtn.disabled = totalItens === 0;
}

novoPedidoItensEl.addEventListener('click', (event) => {
  const botao = event.target.closest('.np-item__botao');
  if (!botao) return;
  const produtoId = Number(botao.dataset.produto);
  const delta = botao.dataset.acao === 'mais' ? 1 : -1;
  alterarQuantidadeNovoPedido(produtoId, delta);
});

// Preço sempre recalculado no banco (lancar_pedido_garcom lê produtos.preco
// de novo) — o total mostrado aqui é só pra conferência do garçom antes de
// confirmar, nunca é o que de fato grava.
async function lancarNovoPedido() {
  const itens = Object.entries(carrinhoNovoPedido).map(([produtoId, quantidade]) => ({
    produto_id: Number(produtoId),
    quantidade,
  }));

  if (itens.length === 0) return;

  novoPedidoLancarBtn.disabled = true;
  novoPedidoLancarBtn.textContent = 'Lançando...';

  const { error } = await supabase.rpc('lancar_pedido_garcom', {
    p_mesa: mesaNovoPedido,
    p_itens: itens,
    p_cliente_nome: novoPedidoNomeInput.value.trim() || null,
  });

  novoPedidoLancarBtn.disabled = false;
  novoPedidoLancarBtn.textContent = 'Lançar pedido';

  if (error) {
    console.error('Erro ao lançar pedido:', error);
    if (error.details === 'MESA_BLOQUEADA') {
      alert('A mesa foi bloqueada de novo antes do pedido ser lançado (talvez por um fechamento em outro aparelho). Feche, libere a mesa de novo e tente lançar o pedido.');
    } else {
      alert(error.message || 'Não foi possível lançar o pedido agora. Verifique sua conexão e tente de novo.');
    }
    return;
  }

  fecharNovoPedido();
  mostrarToast('Pedido lançado!');
  // Não precisa empurrar o pedido novo na lista manualmente: o Realtime de
  // "pedidos" (já assinado, ver inscreverRealtime) traz ele sozinho pra
  // aba Pedidos, do mesmo jeito que traria um pedido feito pelo cliente.
}

novoPedidoLancarBtn.addEventListener('click', lancarNovoPedido);
novoPedidoClose.addEventListener('click', fecharNovoPedido);
novoPedidoOverlay.addEventListener('click', fecharNovoPedido);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && novoPedidoModal.classList.contains('is-open')) {
    fecharNovoPedido();
  }
});

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

async function abrirContaMesa(mesaNumero) {
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
  mesasAtivas = mesasAtivas.filter(s => String(s.mesa) !== String(mesaFechada));
  pedidosGarcom = pedidosGarcom.filter(p => String(p.mesa) !== String(mesaFechada));
  atualizarMesaControleLocal(mesaFechada, 'bloqueada');
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

// ========================================================================
// ABA PEDIDOS — fila de pedidos pendentes (reaproveita a MESMA consulta e
// o MESMO "marcar entregue" de js/balcao.js — nenhuma RPC nova; entregar é
// só um UPDATE em "pedidos" via RLS pedidos_update_authenticated). Sem o
// botão de remover item (fica só no balcão) — versão enxuta pro celular.
// ========================================================================

let pedidosGarcom = []; // pedidos tipo='pedido' status='pendente', cada um já com .itens embutido

function ordenarPedidosGarcom() {
  pedidosGarcom.sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
}

// Mesmo embed do PostgREST usado em balcao.js: "itens:pedido_itens(...)"
// traz os itens do pedido numa consulta só, via FK pedido_itens.pedido_id.
async function carregarPedidosAtivos() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, total, status, criado_em, cliente_nome, itens:pedido_itens(id, nome:nome_snapshot, preco:preco_unitario, quantidade)')
    .eq('tipo', 'pedido')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  pedidosGarcom = data;
}

async function carregarPedidosIniciais() {
  pedidosCarregandoEl.style.display = 'block';
  pedidosErroEl.style.display = 'none';
  pedidosGrid.innerHTML = '';

  try {
    await carregarPedidosAtivos();
    renderizarPedidos();
    pedidosCarregandoEl.style.display = 'none';
  } catch (erro) {
    console.error('Erro ao carregar pedidos:', erro);
    pedidosCarregandoEl.style.display = 'none';
    pedidosErroEl.style.display = 'block';
  }
}

pedidosTentarBtn.addEventListener('click', carregarPedidosIniciais);

function atualizarBadgePedidos() {
  const qtd = pedidosGarcom.length;
  pedidosBadgeEl.textContent = qtd;
  pedidosBadgeEl.hidden = qtd === 0;
}

// Mesmo componente visual .pedido-card de balcao.css — mesa, cliente,
// horário, status, itens e total; sem o botão de remover item.
function renderizarPedidos() {
  atualizarBadgePedidos();

  if (pedidosGarcom.length === 0) {
    pedidosVazioEl.style.display = 'block';
    pedidosGrid.innerHTML = '';
    return;
  }

  pedidosVazioEl.style.display = 'none';
  pedidosGrid.innerHTML = pedidosGarcom.map(pedido => `
    <div class="pedido-card" data-id="${pedido.id}">
      <div>
        <div class="pedido-card__mesa">Mesa ${pedido.mesa}</div>
        ${pedido.cliente_nome ? `<div class="pedido-card__cliente">${escaparTexto(pedido.cliente_nome)}</div>` : ''}
        <div class="pedido-card__horario">${formatarHorarioPedido(pedido.criado_em)}</div>
        <span class="pedido-card__status">Pendente</span>
      </div>
      <ul class="pedido-card__itens">
        ${pedido.itens.map(item => `
          <li>
            <span>${item.quantidade}x ${escaparTexto(item.nome)}</span>
            <span>${formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        `).join('')}
      </ul>
      <div class="pedido-card__total">Total: ${formatarPreco(pedido.total)}</div>
      <button type="button" class="btn btn--primary pedido-card__entregar" data-id="${pedido.id}">Entregue</button>
    </div>
  `).join('');
}

// hh:mm local — mesma ideia de formatarHorario em js/balcao.js, sem
// precisar importar nada extra pra uma função dessas.
function formatarHorarioPedido(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Marca como entregue direto no Supabase (UPDATE simples, mesma RLS que o
// balcão usa) — só some da lista DEPOIS de confirmar, senão avisa que não
// deu certo e deixa como estava, pro garçom tentar de novo.
async function marcarEntregue(id, botao) {
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Marcando...';
  }

  const { error } = await supabase.from('pedidos').update({ status: 'entregue' }).eq('id', id);

  if (error) {
    console.error('Erro ao marcar pedido como entregue:', error);
    alert('Não foi possível marcar como entregue agora. Verifique sua conexão e tente de novo.');
    if (botao) {
      botao.disabled = false;
      botao.textContent = 'Entregue';
    }
    return;
  }

  pedidosGarcom = pedidosGarcom.filter(pedido => pedido.id !== id);
  renderizarPedidos();
}

pedidosGrid.addEventListener('click', (event) => {
  const botao = event.target.closest('.pedido-card__entregar');
  if (!botao) return;
  marcarEntregue(botao.dataset.id, botao);
});

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
  if (novo.status !== 'aberta' || mesasAtivas.some(s => s.id === novo.id)) return;
  mesasAtivas.push(novo);
  renderizarMesas();
}

// Sessão fechada (encerrar_sessao, de QUALQUER aparelho/aba, garçom ou
// balcão) sempre bloqueia a mesa na mesma transação (_bloquear_mesa) — é
// esse evento que avisa este aparelho, na hora, que a mesa acabou de
// bloquear, sem precisar do polling.
function lidarComAtualizacaoSessao(payload) {
  const atualizado = payload.new;
  if (atualizado.status !== 'aberta' && mesasAtivas.some(s => s.id === atualizado.id)) {
    mesasAtivas = mesasAtivas.filter(s => s.id !== atualizado.id);
    renderizarMesas();
    atualizarMesaControleLocal(atualizado.mesa, 'bloqueada');
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

  pedidosGarcom.push({ ...novo, itens: error ? [] : itens });
  ordenarPedidosGarcom();
  renderizarPedidos();
}

// Cobre o caso de outro aparelho (balcão ou outro garçom) ter marcado
// "Entregue"/fechado a conta antes deste: tira da lista local pra não
// ficar dessincronizado.
function lidarComAtualizacaoPedido(payload) {
  const atualizado = payload.new;
  if (atualizado.tipo === 'pedido' && atualizado.status !== 'pendente' && pedidosGarcom.some(p => p.id === atualizado.id)) {
    pedidosGarcom = pedidosGarcom.filter(p => p.id !== atualizado.id);
    renderizarPedidos();
  }
}

function inscreverRealtime() {
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
    await Promise.all([carregarMesasControle(), carregarMesasAtivas()]);
    renderizarMesas();
  } catch (erro) {
    // Silencioso de propósito: um poll que falha não deve incomodar o
    // garçom com alert nenhum — o próximo poll (ou uma ação manual dele)
    // tenta de novo sozinho.
    console.error('Erro no polling de mesas:', erro);
  }
}

function iniciarPollingMesas() {
  pararPollingMesas();
  pollIntervalId = setInterval(reconsultarMesas, INTERVALO_POLL_MESAS);
}

function pararPollingMesas() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

// ========================================================================
// BOOTSTRAP — TEM que ser a ÚLTIMA coisa do arquivo (ver configurarLogin em
// auth.js: qualquer "let" declarado depois ainda estaria na zona morta
// temporal quando aoEntrar rodasse — já aconteceu aqui com
// mesasAtivas/canalRealtime)
// ========================================================================
//
// Papéis aceitos: garcom, balcao OU admin (os três podem operar o salão —
// ver eh_garcom_ou_balcao() em supabase/023_papel_garcom.sql).

await configurarLogin({
  cliente: supabase,
  conteudoEl: document.getElementById('garcomConteudo'),
  papeis: ['garcom', 'balcao', 'admin'],
  mensagemSemPermissao: 'Este usuário não tem permissão de garçom/balcão/admin.',
  aoEntrar: (papel) => {
    papelUsuario = papel;
    carregarMesasIniciais();
    carregarPedidosIniciais();
    inscreverRealtime();
    iniciarPollingMesas();
  },
  aoSair: () => {
    papelUsuario = null;
    pararPollingMesas();
    if (canalRealtime) {
      supabase.removeChannel(canalRealtime);
      canalRealtime = null;
    }
  },
});
