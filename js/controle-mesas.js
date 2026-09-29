// ========================================================================
// Controle de mesas — ações compartilhadas por balcao.html e garcom.html
// ========================================================================
//
// Toda mesa tem status_mesa (liberada/bloqueada — ver
// supabase/019_bloqueio_mesa.sql) e pode estar ativa ou não. As duas telas
// mostram a mesma lista (cada uma com o seu desenho de card) e fazem as
// mesmas ações: liberar uma mesa, ativar/desativar (ver
// supabase/020_ativar_desativar_mesa_balcao.sql) e liberar/bloquear todas
// de uma vez (ver supabase/022_mesas_em_massa.sql). "mesas" não tem
// Realtime de propósito (o token é secreto), então mudanças feitas em outro
// aparelho chegam pelo polling de cada tela, que chama carregar() de novo.
//
// criarControleMesas() recebe o client Supabase da tela (o garçom tem o
// seu, ver js/supabaseClientGarcom.js) e a função que redesenha os cards
// depois de cada mudança. Os botões de ação em massa têm o mesmo id nas
// duas telas (#liberarTodasBtn / #bloquearTodasBtn).

import { mostrarToast } from './shared.js';

export function criarControleMesas({ cliente, redesenhar }) {
  const liberarTodasBtn = document.getElementById('liberarTodasBtn');
  const bloquearTodasBtn = document.getElementById('bloquearTodasBtn');

  const controle = {
    mesas: [], // TODAS as mesas ({numero, status_mesa, ativa}) — ver listar_mesas_balcao

    // Lista TODAS as mesas via RPC — nunca consulta a tabela "mesas" direto:
    // RLS restringe o SELECT direto a admin (o token é secreto, ver
    // 005_seguranca.sql). listar_mesas_balcao devolve só
    // número/status_mesa/ativa, nunca o token.
    async carregar() {
      const { data, error } = await cliente.rpc('listar_mesas_balcao');
      if (error) throw error;
      controle.mesas = data;
    },

    // Atualiza o status de UMA mesa (sem recarregar a lista inteira) e
    // redesenha — usado pelas ações locais (liberar, fechamentos totais) e
    // pelo evento de Realtime de sessão fechando em outro aparelho.
    atualizarLocal(mesa, novoStatus) {
      const entrada = controle.mesas.find(m => String(m.numero) === String(mesa));
      if (entrada) entrada.status_mesa = novoStatus;
      redesenhar();
    },

    // liberar_mesa é o único caminho de volta pra 'liberada', sempre sob
    // toque explícito de quem confirma que tem gente sentada de verdade.
    async liberar(mesa, botao) {
      if (botao) {
        botao.disabled = true;
        botao.textContent = 'Liberando...';
      }

      const { error } = await cliente.rpc('liberar_mesa', { p_mesa: Number(mesa) });

      if (error) {
        console.error('Erro ao liberar mesa:', error);
        alert('Não foi possível liberar a mesa agora. Verifique sua conexão e tente de novo.');
        if (botao) {
          botao.disabled = false;
          botao.textContent = 'Liberar mesa';
        }
        return;
      }

      controle.atualizarLocal(mesa, 'liberada');
    },

    // Ativa/desativa a mesa (mesas.ativa) — mesmo efeito de "Ativar"/
    // "Desativar" na página de mesas do admin, sem precisar sair daqui.
    async desativar(mesa, botao) {
      const confirmou = confirm(`Desativar a mesa ${mesa}? Ela some do cardápio pro cliente até alguém reativar.`);
      if (!confirmou) return;

      if (botao) {
        botao.disabled = true;
        botao.textContent = 'Desativando...';
      }

      const { error } = await cliente.rpc('desativar_mesa', { p_mesa: Number(mesa) });

      if (error) {
        console.error('Erro ao desativar mesa:', error);
        alert('Não foi possível desativar a mesa agora. Verifique sua conexão e tente de novo.');
        if (botao) {
          botao.disabled = false;
          botao.textContent = 'Desativar mesa';
        }
        return;
      }

      const entrada = controle.mesas.find(m => String(m.numero) === String(mesa));
      if (entrada) entrada.ativa = false;
      redesenhar();
    },

    async ativar(mesa, botao) {
      if (botao) {
        botao.disabled = true;
        botao.textContent = 'Ativando...';
      }

      const { error } = await cliente.rpc('ativar_mesa', { p_mesa: Number(mesa) });

      if (error) {
        console.error('Erro ao ativar mesa:', error);
        alert('Não foi possível ativar a mesa agora. Verifique sua conexão e tente de novo.');
        if (botao) {
          botao.disabled = false;
          botao.textContent = 'Ativar mesa';
        }
        return;
      }

      const entrada = controle.mesas.find(m => String(m.numero) === String(mesa));
      if (entrada) entrada.ativa = true;
      redesenhar();
    },

    // Ações em massa (abertura/fechamento do salão): depois de qualquer uma,
    // recarrega a lista inteira em vez de tentar adivinhar localmente quem
    // mudou — mais simples e sempre correto (as RPCs mexem em várias linhas).
    async liberarTodas() {
      const confirmou = confirm('Liberar todas as mesas para pedido?');
      if (!confirmou) return;

      liberarTodasBtn.disabled = true;

      const { data: qtd, error } = await cliente.rpc('liberar_todas_mesas');

      liberarTodasBtn.disabled = false;

      if (error) {
        console.error('Erro ao liberar todas as mesas:', error);
        alert('Não foi possível liberar as mesas agora. Verifique sua conexão e tente de novo.');
        return;
      }

      try {
        await controle.carregar();
      } catch (erro) {
        console.error('Erro ao recarregar mesas depois de liberar todas:', erro);
      }
      redesenhar();
      mostrarToast(`${qtd} ${qtd === 1 ? 'mesa liberada' : 'mesas liberadas'}.`);
    },

    // Chama bloquear_todas_mesas primeiro sem forçar; se sobrar mesa pulada
    // por ter conta aberta, avisa e só bloqueia essas também com uma SEGUNDA
    // confirmação explícita (p_forcar=true) — nunca interrompe conta em
    // andamento sem o operador saber exatamente o que está fazendo.
    async bloquearTodas() {
      const confirmou = confirm('Bloquear todas as mesas?');
      if (!confirmou) return;

      bloquearTodasBtn.disabled = true;

      const { data: resultado, error } = await cliente.rpc('bloquear_todas_mesas', { p_forcar: false });

      if (error) {
        console.error('Erro ao bloquear todas as mesas:', error);
        bloquearTodasBtn.disabled = false;
        alert('Não foi possível bloquear as mesas agora. Verifique sua conexão e tente de novo.');
        return;
      }

      try {
        await controle.carregar();
      } catch (erro) {
        console.error('Erro ao recarregar mesas depois de bloquear todas:', erro);
      }
      redesenhar();

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

      const { data: resultadoForcado, error: erroForcado } = await cliente.rpc('bloquear_todas_mesas', { p_forcar: true });

      bloquearTodasBtn.disabled = false;

      if (erroForcado) {
        console.error('Erro ao forçar bloqueio de todas as mesas:', erroForcado);
        alert('Não foi possível bloquear as mesas restantes agora. Verifique sua conexão e tente de novo.');
        return;
      }

      try {
        await controle.carregar();
      } catch (erro) {
        console.error('Erro ao recarregar mesas depois de forçar bloquear todas:', erro);
      }
      redesenhar();
      mostrarToast(`${resultadoForcado.bloqueadas} ${resultadoForcado.bloqueadas === 1 ? 'mesa bloqueada' : 'mesas bloqueadas'} (incluindo com conta aberta).`);
    },
  };

  liberarTodasBtn.addEventListener('click', controle.liberarTodas);
  bloquearTodasBtn.addEventListener('click', controle.bloquearTodas);

  return controle;
}
