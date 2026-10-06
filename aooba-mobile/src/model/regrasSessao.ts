// ========================================================================
// Regras da sessão da mesa (funções puras) — porte de aooba-react/src/lib/sessaoCliente.ts.
//
// O token DA MESA (QR) é permanente; quem autoriza pedir/fechar conta é o token de SESSÃO, temporário.
// O que fica guardado no aparelho NUNCA autoriza nada — só decide qual tela mostrar; a defesa real
// é o servidor (supabase/017_token_sessao.sql).
// ========================================================================

import type { SessaoAtual } from './types';

export interface SessaoGuardada {
  sessaoId: string;
  tokenSessao: string;
}

export interface MarcaEncerrada {
  mesa: number;
  sessaoId: string;
  encerradaEm: string;
}

export type DecisaoSemSessao =
  | { tela: 'mesa_bloqueada' }
  | { tela: 'conta_encerrada'; sessaoIdEncerrada: string }
  | { tela: 'boas_vindas' };

/**
 * Sem sessão aberta na mesa: mesa bloqueada vence tudo; senão, se este aparelho tinha uma sessão
 * (guardada ou marca), a conta encerrou; senão é cliente novo / mesa livre.
 */
export function decidirSemSessao(params: {
  statusMesa: string | null;
  guardada: SessaoGuardada | null;
  marca: MarcaEncerrada | null;
}): DecisaoSemSessao {
  if (params.statusMesa === 'bloqueada') return { tela: 'mesa_bloqueada' };
  const sessaoIdEncerrada = params.guardada?.sessaoId || params.marca?.sessaoId || null;
  if (sessaoIdEncerrada) return { tela: 'conta_encerrada', sessaoIdEncerrada };
  return { tela: 'boas_vindas' };
}

/** Há sessão aberta: entra direto só se este aparelho já tinha confirmado exatamente ela. */
export function decidirComSessao(atual: SessaoAtual, guardada: SessaoGuardada | null): 'entrar' | 'confirmar' {
  const mesma = guardada && guardada.sessaoId === atual.sessao_id && guardada.tokenSessao === atual.token_sessao;
  return mesma ? 'entrar' : 'confirmar';
}
