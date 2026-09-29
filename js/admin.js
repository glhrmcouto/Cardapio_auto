// ========================================
// PAINEL ADMIN — cardápio, mesas e configurações
// ========================================
//
// Exige duas coisas pra mostrar qualquer coisa: sessão autenticada (Supabase
// Auth, igual balcao.html) E papel "admin" na tabela "perfis" (ver
// supabase/003_admin.sql). Login sem o papel certo é barrado e deslogado.
//
// Três painéis independentes, cada um num módulo de js/admin/:
//   produtos.js → cardápio (editar, ativar/desativar, excluir, reordenar, criar)
//   mesas.js    → mesas e token do QR code
//   config.js   → configurações (taxa de serviço)

import { configurarLogin } from './auth.js';
import { carregarProdutos } from './admin/produtos.js';
import { carregarMesas } from './admin/mesas.js';
import { carregarConfiguracoes } from './admin/config.js';

// ========================================
// BOOTSTRAP (fica por último de propósito — ver configurarLogin em auth.js)
// ========================================

await configurarLogin({
  conteudoEl: document.getElementById('adminConteudo'),
  exigirAdmin: true,
  aoEntrar: () => Promise.all([carregarProdutos(), carregarMesas(), carregarConfiguracoes()]),
});
