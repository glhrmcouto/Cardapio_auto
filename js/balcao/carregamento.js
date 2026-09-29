import { supabase } from '../supabaseClient.js';
import { estado } from './estado.js';
import { controleMesas, controleMesasGrid, renderizarControleMesas } from './controle.js';
import { balcaoGrid, balcaoVazio, renderizarPedidos } from './fila.js';
import { fechamentoGrid, renderizarFechamentos } from './fechamentos.js';
import { pagamentoGrid, renderizarPagamentosPendentes } from './pagamentos.js';
import { mesasAtivasGrid, renderizarMesasAtivas } from './mesas-ativas.js';

const balcaoErroEl = document.getElementById('balcaoErro');
const balcaoTentarBtn = document.getElementById('balcaoTentar');

// ========================================
// CARREGAMENTO INICIAL (Supabase)
// ========================================
//
// "itens:pedido_itens(nome:nome_snapshot, preco:preco_unitario, quantidade)" usa o
// embed automático do PostgREST pela FK pedido_itens.pedido_id -> pedidos.id, já
// apelidando as colunas pra "nome"/"preco" — assim o resto do arquivo (os templates
// de card) fica idêntico ao que já era antes, só trocando de onde os dados vêm.

// Lançam o erro em vez de engolir (pedidos = []) de propósito: um balcão que
// mostra "nenhum pedido pendente" porque a consulta falhou é pior que não
// mostrar nada — o garçom lê aquilo como "salão vazio" e pode deixar cliente
// esperando. Quem decide o que fazer com a falha é carregarTudoInicial.
async function carregarPedidosPendentes() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, total, status, criado_em, cliente_nome, itens:pedido_itens(id, nome:nome_snapshot, preco:preco_unitario, quantidade)')
    .eq('tipo', 'pedido')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  estado.pedidos = data;
}

async function carregarFechamentosPendentes() {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, mesa, criado_em')
    .eq('tipo', 'fechar_conta')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  estado.fechamentos = data;
}

// "sessoes(mesa)" usa o embed do PostgREST pela FK pagamentos.sessao_id ->
// sessoes.id — pagamentos não guarda o número da mesa direto (só sessao_id),
// então é assim que a gente descobre de qual mesa é cada pagamento pendente.
async function carregarPagamentosPendentes() {
  const { data, error } = await supabase
    .from('pagamentos')
    .select('id, sessao_id, cliente_id, nome, subtotal, taxa_servico, valor_total, taxa_aceita, status, criado_em, sessoes(mesa)')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) throw error;
  estado.pagamentosPendentes = data.map(p => ({ ...p, mesa: p.sessoes ? p.sessoes.mesa : null }));
}

// Toda mesa com sessão aberta agora, ocupada ou não (ver supabase/008_sessoes.sql)
// — é essa lista que vira o painel "Mesas Ativas", pra mostrar o consumo de
// cada mesa mesmo antes de alguém pedir pra fechar a conta.
async function carregarMesasAtivas() {
  const { data, error } = await supabase
    .from('sessoes')
    .select('id, mesa, aberta_em')
    .eq('status', 'aberta')
    .order('mesa');

  if (error) throw error;
  estado.mesasAtivas = data;
}

export async function carregarTudoInicial() {
  balcaoErroEl.style.display = 'none';

  try {
    await Promise.all([
      carregarPedidosPendentes(),
      carregarFechamentosPendentes(),
      carregarPagamentosPendentes(),
      carregarMesasAtivas(),
      controleMesas.carregar(),
    ]);
  } catch (erro) {
    console.error('Erro ao carregar estado.pedidos/estado.fechamentos:', erro);
    balcaoGrid.innerHTML = '';
    fechamentoGrid.innerHTML = '';
    pagamentoGrid.innerHTML = '';
    mesasAtivasGrid.innerHTML = '';
    controleMesasGrid.innerHTML = '';
    balcaoVazio.style.display = 'none';
    balcaoErroEl.style.display = 'block';
    return;
  }

  renderizarPedidos();
  await renderizarPagamentosPendentes();
  await renderizarFechamentos();
  await renderizarMesasAtivas();
  renderizarControleMesas();
}

balcaoTentarBtn.addEventListener('click', carregarTudoInicial);
