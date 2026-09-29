import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { obterContaAtivaDaMesa } from '../lib/contas';
import type { ContaBalcao } from '../lib/types';

/** Conta da sessão aberta da mesa; rebusca sempre que `versao` muda. */
export function useContaAtiva(cliente: SupabaseClient, mesa: number | string, versao: number): ContaBalcao | null {
  const [conta, setConta] = useState<ContaBalcao | null>(null);

  useEffect(() => {
    let vivo = true;
    void obterContaAtivaDaMesa(cliente, mesa).then((c) => {
      if (vivo) setConta(c);
    });
    return () => {
      vivo = false;
    };
  }, [cliente, mesa, versao]);

  return conta;
}
