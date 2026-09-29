// ========================================================================
// Regras da sessão da mesa no cardápio do cliente (funções puras + storage).
//
// O token DA MESA (QR) é permanente; quem autoriza pedir/fechar conta é o
// token de SESSÃO, temporário. O storage aqui NUNCA autoriza nada — só serve
// de comparação/UX; a defesa real é o servidor (ver supabase/017_token_sessao.sql).
// ========================================================================

import type { SessaoAtual } from './types';

const SESSAO_ID_KEY = 'aooba_sessao_id';
const SESSAO_TOKEN_KEY = 'aooba_sessao_token';
const SESSAO_MESA_KEY = 'aooba_sessao_mesa';
const CONTA_ENCERRADA_KEY = 'aooba_encerrada';
const CLIENTE_ID_KEY = 'aooba_cliente_id';
const CLIENTE_NOME_KEY = 'aooba_cliente_nome';

export interface SessaoGuardada {
  sessaoId: string;
  tokenSessao: string;
}

export interface MarcaEncerrada {
  mesa: string;
  session_id: string;
  encerrada_em: string;
}

/** Erro de RPC como devolvido pelo supabase-js (PostgrestError). */
export interface ErroRpc {
  message: string;
  details?: string | null;
}

export const ehErroSessaoEncerrada = (erro: ErroRpc | null | undefined) => Boolean(erro) && erro!.details === 'SESSAO_ENCERRADA';
export const ehErroMesaBloqueada = (erro: ErroRpc | null | undefined) => Boolean(erro) && erro!.details === 'MESA_BLOQUEADA';

// ---- sessionStorage: sessão confirmada desta aba (sobrevive a F5) ----

export function lerSessaoStorage(mesa: string, storage: Storage = sessionStorage): SessaoGuardada | null {
  const mesaGuardada = storage.getItem(SESSAO_MESA_KEY);
  const id = storage.getItem(SESSAO_ID_KEY);
  const token = storage.getItem(SESSAO_TOKEN_KEY);
  if (mesaGuardada && id && token && mesaGuardada === mesa) return { sessaoId: id, tokenSessao: token };
  return null;
}

export function gravarSessaoStorage(id: string, token: string, mesa: string, storage: Storage = sessionStorage) {
  storage.setItem(SESSAO_ID_KEY, id);
  storage.setItem(SESSAO_TOKEN_KEY, token);
  storage.setItem(SESSAO_MESA_KEY, mesa);
}

export function limparSessaoStorage(storage: Storage = sessionStorage) {
  storage.removeItem(SESSAO_ID_KEY);
  storage.removeItem(SESSAO_TOKEN_KEY);
  storage.removeItem(SESSAO_MESA_KEY);
}

// ---- localStorage: marca de "conta encerrada" (sobrevive a fechar/reabrir a aba) ----

export function marcarContaEncerrada(mesa: string, sessaoId: string | null, storage: Storage = localStorage) {
  if (!mesa || !sessaoId) return;
  try {
    const marca: MarcaEncerrada = { mesa: String(mesa), session_id: sessaoId, encerrada_em: new Date().toISOString() };
    storage.setItem(CONTA_ENCERRADA_KEY, JSON.stringify(marca));
  } catch (erro) {
    console.warn('Não foi possível gravar aooba_encerrada:', erro);
  }
}

/** Devolve a marca só se for desta MESMA mesa. */
export function lerContaEncerrada(mesa: string, storage: Storage = localStorage): MarcaEncerrada | null {
  try {
    const bruto = storage.getItem(CONTA_ENCERRADA_KEY);
    if (!bruto) return null;
    const marca = JSON.parse(bruto) as MarcaEncerrada;
    return marca && marca.mesa === String(mesa) ? marca : null;
  } catch (erro) {
    console.warn('Não foi possível ler aooba_encerrada:', erro);
    return null;
  }
}

export function limparContaEncerrada(storage: Storage = localStorage) {
  try {
    storage.removeItem(CONTA_ENCERRADA_KEY);
  } catch (erro) {
    console.warn('Não foi possível limpar aooba_encerrada:', erro);
  }
}

// ---- decisões (puras) ----

export type DecisaoSemSessao =
  | { tela: 'mesa_bloqueada' }
  | { tela: 'conta_encerrada'; sessaoIdEncerrada: string }
  | { tela: 'boas_vindas' };

/**
 * Sem sessão aberta na mesa: mesa bloqueada vence tudo; senão, se este
 * aparelho tinha uma sessão (guardada ou marca), a conta encerrou; senão é
 * cliente novo / mesa livre.
 */
export function decidirSemSessao(params: {
  statusMesa: string | null;
  guardada: SessaoGuardada | null;
  marca: MarcaEncerrada | null;
}): DecisaoSemSessao {
  if (params.statusMesa === 'bloqueada') return { tela: 'mesa_bloqueada' };
  const sessaoIdEncerrada = params.guardada?.sessaoId || params.marca?.session_id || null;
  if (sessaoIdEncerrada) return { tela: 'conta_encerrada', sessaoIdEncerrada };
  return { tela: 'boas_vindas' };
}

/** Há sessão aberta: entra direto só se este navegador já tinha confirmado exatamente ela. */
export function decidirComSessao(atual: SessaoAtual, guardada: SessaoGuardada | null): 'entrar' | 'confirmar' {
  const mesma = guardada && guardada.sessaoId === atual.sessao_id && guardada.tokenSessao === atual.token_sessao;
  return mesma ? 'entrar' : 'confirmar';
}

// ---- identificação da pessoa (sem login) ----

export function obterOuCriarClienteId(storage: Storage = sessionStorage): string {
  let id = storage.getItem(CLIENTE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(CLIENTE_ID_KEY, id);
  }
  return id;
}

export const lerClienteNome = (storage: Storage = sessionStorage) => storage.getItem(CLIENTE_NOME_KEY) || '';
export const gravarClienteNome = (nome: string, storage: Storage = sessionStorage) => storage.setItem(CLIENTE_NOME_KEY, nome);
