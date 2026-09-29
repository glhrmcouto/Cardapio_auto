// ========================================
// CARDÁPIO PÚBLICO (index.html) — ponto de entrada
// ========================================
//
// Cada módulo de js/cardapio/ roda a sua parte da página assim que é
// importado (busca elementos, registra eventos, faz a primeira carga). A
// ordem dos imports abaixo é a ordem em que isso acontece — mesma ordem das
// seções do antigo script.js único:
//
//   offline.js   → aviso de "sem conexão" no topo
//   menu.js      → carrega os produtos do Supabase e desenha os cards
//   mesa.js      → mesa/token do QR, bloqueio de acesso e vínculo de sessão
//   cliente.js   → nome/apelido da pessoa (modal) e cliente_id
//   carrinho.js  → carrinho e envio de pedido (RPC criar_pedido)
//   conta.js     → modal "Minha parte" / "Conta da mesa" e fechamentos

import './cardapio/offline.js';
import './cardapio/menu.js';
import './cardapio/mesa.js';
import './cardapio/cliente.js';
import './cardapio/carrinho.js';
import './cardapio/conta.js';
