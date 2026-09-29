import { estado } from './estado.js';
import { formatarHorario, htmlListaItens, htmlResumoConta, obterContaAtivaDaMesa } from './conta.js';

export const mesasAtivasGrid = document.getElementById('mesasAtivasGrid');
const mesasAtivasVazio = document.getElementById('mesasAtivasVazio');

// ========================================
// MESAS ATIVAS (visão geral, mesa por mesa)
// ========================================
//
// Uma mesa entra nessa lista assim que a sessão dela abre (primeiro pedido —
// ver criar_pedido em supabase/008_sessoes.sql) e sai quando a sessão fecha
// (encerrar_sessao). Reaproveita obterContaAtivaDaMesa (mesma RPC
// conta_da_mesa_balcao do card de fechamento) pra montar itens + subtotal/
// serviço/total/saldo de cada mesa, mesmo antes de alguém pedir pra fechar.

export async function renderizarMesasAtivas() {
  if (estado.mesasAtivas.length === 0) {
    mesasAtivasVazio.style.display = 'block';
    mesasAtivasGrid.innerHTML = '';
    return;
  }

  mesasAtivasVazio.style.display = 'none';

  const cards = await Promise.all(estado.mesasAtivas.map(async sessao => {
    const conta = await obterContaAtivaDaMesa(sessao.mesa);

    return `
    <div class="mesa-ativa-card" data-mesa="${sessao.mesa}">
      <div class="mesa-ativa-card__mesa">Mesa ${sessao.mesa}</div>
      <div class="mesa-ativa-card__horario">Aberta às ${formatarHorario(sessao.aberta_em)}</div>
      ${conta.itens.length === 0
        ? '<p class="mesa-ativa-card__vazio">Nenhum pedido registrado ainda.</p>'
        : htmlListaItens(conta.itens)
      }
      ${htmlResumoConta(conta)}
    </div>
  `;
  }));

  mesasAtivasGrid.innerHTML = cards.join('');
}
