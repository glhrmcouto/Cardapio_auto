// ========================================
// TELA DO BALCÃO — recebe os pedidos do cardápio em tempo real via Supabase
// ========================================
//
// Nada aparece sem login (supabase.auth.signInWithPassword). A sessão persiste
// sozinha entre recarregamentos (comportamento padrão do supabase-js, guardada
// no localStorage do navegador). Depois de logado, carrega os pedidos/fechamentos
// pendentes uma vez e assina Realtime (INSERT/UPDATE em "pedidos") pra tudo o
// mais chegar sozinho, sem precisar recarregar a página — inclusive de outro
// aparelho (celular do cliente fazendo pedido enquanto o balcão fica no PC).
//
// O código fica em js/balcao/, um módulo por painel da tela:
//   carregamento.js  → carga inicial de tudo (com tela de erro + "tentar de novo")
//   fila.js          → Fila de Pedidos ("Entregue", remover item)
//   fechamentos.js   → fechar a conta da mesa (alerta do cliente ou "Fechar mesa")
//   pagamentos.js    → pagamentos parciais ("fechar minha parte")
//   mesas-ativas.js  → visão geral de cada mesa com sessão aberta
//   controle.js      → modal de Controle de Mesas + polling (ver js/controle-mesas.js)
//   realtime.js      → assinatura Realtime que mantém tudo isso atualizado
//   historico.js     → modal de histórico de pedidos
//   senha.js         → confirmação de senha antes de ações difíceis de desfazer
//   som.js, conexao.js → beep de pedido novo e indicador de conexão
//   conta.js, estado.js → formatação/templates/RPCs de conta e as listas compartilhadas

import { supabase } from './supabaseClient.js';
import { configurarLogin } from './auth.js';
import './balcao/senha.js';
import './balcao/conexao.js';
import './balcao/som.js';
import { estado } from './balcao/estado.js';
import { carregarTudoInicial } from './balcao/carregamento.js';
import { renderizarPedidos } from './balcao/fila.js';
import { fechamentoGrid } from './balcao/fechamentos.js';
import { pagamentoGrid } from './balcao/pagamentos.js';
import { mesasAtivasGrid } from './balcao/mesas-ativas.js';
import { controleMesasBtn, controleMesasModal, fecharControleMesas, iniciarPollingMesas, pararPollingMesas } from './balcao/controle.js';
import { inscreverRealtime, desinscreverRealtime } from './balcao/realtime.js';
import { historicoBtn, historicoModal, fecharHistorico } from './balcao/historico.js';

// Esc fecha o modal de histórico ou o de controle de mesas (o que estiver
// aberto) e devolve o foco pro botão que o abriu
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  if (historicoModal.classList.contains('is-open')) {
    fecharHistorico();
    historicoBtn.focus();
  } else if (controleMesasModal.classList.contains('is-open')) {
    fecharControleMesas();
    controleMesasBtn.focus();
  }
});

// ========================================
// BOOTSTRAP (fica por último de propósito — ver configurarLogin em auth.js)
// ========================================

await configurarLogin({
  cliente: supabase,
  conteudoEl: document.getElementById('balcaoConteudo'),
  papeis: null,
  aoEntrar: async () => {
    await carregarTudoInicial();
    inscreverRealtime();
    iniciarPollingMesas();
  },
  aoSair: () => {
    desinscreverRealtime();
    pararPollingMesas();
    estado.pedidos = [];
    estado.fechamentos = [];
    estado.pagamentosPendentes = [];
    estado.mesasAtivas = [];
    renderizarPedidos();
    fechamentoGrid.innerHTML = '';
    pagamentoGrid.innerHTML = '';
    mesasAtivasGrid.innerHTML = '';
  },
});
