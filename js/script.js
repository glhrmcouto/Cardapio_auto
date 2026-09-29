// ========================================
// CARDÁPIO PÚBLICO (index.html) — ponto de entrada
// ========================================
//
// Cada módulo de js/cardapio/ roda a sua parte da página assim que é
// importado (busca elementos, registra eventos, faz a primeira carga). A
// ordem dos imports abaixo é a ordem em que isso acontece:
//
//   offline.js   → aviso de "sem conexão" no topo
//   menu.js      → cards do cardápio (carregados só depois de entrar numa sessão)
//   mesa.js      → mesa/token do QR e bloqueio de acesso
//   cliente.js   → nome/apelido da pessoa (modal) e cliente_id
//   sessao.js    → token de sessão, telas de trava e a checagem inicial
//   carrinho.js  → carrinho e envio de pedido (RPC criar_pedido)
//   conta.js     → modal "Minha parte" / "Conta da mesa" e fechamentos

import './cardapio/offline.js';
import './cardapio/menu.js';
import './cardapio/mesa.js';
import './cardapio/cliente.js';
import './cardapio/sessao.js';
import './cardapio/carrinho.js';
import './cardapio/conta.js';
