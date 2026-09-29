import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContaBalcao } from './types';

export const CONTA_VAZIA: ContaBalcao = {
  itens: [],
  subtotal: 0,
  taxa_servico: 0,
  total_geral: 0,
  total_pago: 0,
  total_pendente_confirmacao: 0,
  saldo_restante: 0,
  por_pessoa: [],
};

/** Conta da sessão aberta da mesa (RPC conta_da_mesa_balcao). Em erro devolve conta vazia. */
export async function obterContaAtivaDaMesa(cliente: SupabaseClient, mesa: number | string): Promise<ContaBalcao> {
  const { data, error } = await cliente.rpc('conta_da_mesa_balcao', { p_mesa: Number(mesa) });
  if (error) {
    console.error('Erro ao consultar itens da mesa:', error);
    return CONTA_VAZIA;
  }
  return data as ContaBalcao;
}

export interface Confirmador {
  confirm: (msg: string) => boolean;
  alert: (msg: string) => void;
}

const confirmadorPadrao: Confirmador = {
  confirm: (msg) => window.confirm(msg),
  alert: (msg) => window.alert(msg),
};

/**
 * Tenta encerrar a sessão sem forçar; se sobrar saldo, pergunta se fecha mesmo
 * assim (p_forcar=true). Devolve true se a sessão acabou encerrada.
 */
export async function tentarEncerrarSessao(
  cliente: SupabaseClient,
  mesa: number | string,
  ui: Confirmador = confirmadorPadrao,
): Promise<boolean> {
  const { error } = await cliente.rpc('encerrar_sessao', { p_mesa: Number(mesa), p_forcar: false });
  if (!error) return true;

  if (error.details === 'CONTA_JA_ENCERRADA') {
    // Provavelmente já fechada pelo encerramento automático — segue o fluxo normal.
    ui.alert(error.message);
    return true;
  }

  if (error.message?.startsWith('Ainda falta receber')) {
    if (!ui.confirm(`${error.message}\n\nFechar a conta mesmo assim?`)) return false;

    const { error: erroForcado } = await cliente.rpc('encerrar_sessao', { p_mesa: Number(mesa), p_forcar: true });
    if (erroForcado) {
      console.error('Erro ao forçar fechamento da sessão:', erroForcado);
      ui.alert('Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
      return false;
    }
    return true;
  }

  console.error('Erro ao finalizar fechamento:', error);
  ui.alert(error.message || 'Não foi possível fechar a conta agora. Verifique sua conexão e tente de novo.');
  return false;
}
