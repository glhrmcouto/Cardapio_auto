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
//   fila.js          → Fila de Pedidos ("Entregue")
//   fechamentos.js   → alertas de "fechar conta" da mesa inteira
//   pagamentos.js    → pagamentos parciais ("fechar minha parte")
//   mesas-ativas.js  → visão geral de cada mesa com sessão aberta
//   realtime.js      → assinatura Realtime que mantém tudo isso atualizado
//   historico.js     → modal de histórico de pedidos
//   som.js, conexao.js → beep de pedido novo e indicador de conexão
//   conta.js, estado.js → templates/formatação e as listas compartilhadas

import { configurarLogin } from './auth.js';
import './balcao/conexao.js';
import './balcao/som.js';
import { estado } from './balcao/estado.js';
import { carregarTudoInicial } from './balcao/carregamento.js';
import { renderizarPedidos } from './balcao/fila.js';
import { fechamentoGrid } from './balcao/fechamentos.js';
import { pagamentoGrid } from './balcao/pagamentos.js';
import { mesasAtivasGrid } from './balcao/mesas-ativas.js';
import { inscreverRealtime, desinscreverRealtime } from './balcao/realtime.js';
import './balcao/historico.js';

// ========================================
// BOOTSTRAP (fica por último de propósito — ver configurarLogin em auth.js)
// ========================================
//
// Depois de logado, carrega os dados iniciais uma vez e assina o Realtime;
// no logout (inclusive feito em outra aba), desassina e limpa tudo.

await configurarLogin({
  conteudoEl: document.getElementById('balcaoConteudo'),
  exigirAdmin: false,
  aoEntrar: async () => {
    await carregarTudoInicial();
    inscreverRealtime();
  },
  aoSair: () => {
    desinscreverRealtime();
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
