import { useCallback, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Mesa } from '../lib/types';
import { useToast } from '../components/Toast';

export type MesaControle = Pick<Mesa, 'numero' | 'status_mesa' | 'ativa'>;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Ações de mesa compartilhadas por balcão e garçom (liberar/bloquear/ativar/
 * desativar, e em massa). Equivale ao antigo criarControleMesas.
 */
export function useControleMesas(cliente: SupabaseClient) {
  const toast = useToast();
  const [mesas, setMesas] = useState<MesaControle[]>([]);
  /** Chave da ação em andamento (ex.: "liberar-3", "liberar-todas") para desabilitar botões. */
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await cliente.rpc('listar_mesas_balcao');
    if (error) throw error;
    setMesas(data as MesaControle[]);
  }, [cliente]);

  const atualizarLocal = useCallback((mesa: number | string, status_mesa: 'liberada' | 'bloqueada') => {
    setMesas((l) => l.map((m) => (String(m.numero) === String(mesa) ? { ...m, status_mesa } : m)));
  }, []);

  const definirAtiva = useCallback((mesa: number | string, ativa: boolean) => {
    setMesas((l) => l.map((m) => (String(m.numero) === String(mesa) ? { ...m, ativa } : m)));
  }, []);

  const recarregarSilencioso = useCallback(async () => {
    try {
      await carregar();
    } catch (erro) {
      console.error('Erro ao recarregar mesas:', erro);
    }
  }, [carregar]);

  const liberar = useCallback(
    async (mesa: number) => {
      setOcupado(`liberar-${mesa}`);
      const { error } = await cliente.rpc('liberar_mesa', { p_mesa: mesa });
      setOcupado(null);
      if (error) {
        console.error('Erro ao liberar mesa:', error);
        window.alert('Não foi possível liberar a mesa agora. Verifique sua conexão e tente de novo.');
        return;
      }
      atualizarLocal(mesa, 'liberada');
    },
    [cliente, atualizarLocal],
  );

  const desativar = useCallback(
    async (mesa: number) => {
      if (!window.confirm(`Desativar a mesa ${mesa}? Ela some do cardápio pro cliente até alguém reativar.`)) return;
      setOcupado(`desativar-${mesa}`);
      const { error } = await cliente.rpc('desativar_mesa', { p_mesa: mesa });
      setOcupado(null);
      if (error) {
        console.error('Erro ao desativar mesa:', error);
        window.alert('Não foi possível desativar a mesa agora. Verifique sua conexão e tente de novo.');
        return;
      }
      definirAtiva(mesa, false);
    },
    [cliente, definirAtiva],
  );

  const ativar = useCallback(
    async (mesa: number) => {
      setOcupado(`ativar-${mesa}`);
      const { error } = await cliente.rpc('ativar_mesa', { p_mesa: mesa });
      setOcupado(null);
      if (error) {
        console.error('Erro ao ativar mesa:', error);
        window.alert('Não foi possível ativar a mesa agora. Verifique sua conexão e tente de novo.');
        return;
      }
      definirAtiva(mesa, true);
    },
    [cliente, definirAtiva],
  );

  const liberarTodas = useCallback(async () => {
    if (!window.confirm('Liberar todas as mesas para pedido?')) return;
    setOcupado('liberar-todas');
    const { data: qtd, error } = await cliente.rpc('liberar_todas_mesas');
    setOcupado(null);
    if (error) {
      console.error('Erro ao liberar todas as mesas:', error);
      window.alert('Não foi possível liberar as mesas agora. Verifique sua conexão e tente de novo.');
      return;
    }
    await recarregarSilencioso();
    toast(`${plural(qtd as number, 'mesa liberada', 'mesas liberadas')}.`);
  }, [cliente, recarregarSilencioso, toast]);

  const bloquearTodas = useCallback(async () => {
    if (!window.confirm('Bloquear todas as mesas?')) return;
    setOcupado('bloquear-todas');
    try {
      const { data: r1, error } = await cliente.rpc('bloquear_todas_mesas', { p_forcar: false });
      if (error) {
        console.error('Erro ao bloquear todas as mesas:', error);
        window.alert('Não foi possível bloquear as mesas agora. Verifique sua conexão e tente de novo.');
        return;
      }
      await recarregarSilencioso();

      const { bloqueadas, puladas } = r1 as { bloqueadas: number; puladas: number };
      if (puladas === 0) {
        toast(`${plural(bloqueadas, 'mesa bloqueada', 'mesas bloqueadas')}.`);
        return;
      }

      const forcar = window.confirm(
        `${plural(bloqueadas, 'mesa foi bloqueada', 'mesas foram bloqueadas')}. ` +
          `${puladas} ${puladas === 1 ? 'mesa tem' : 'mesas têm'} conta aberta e NÃO ${puladas === 1 ? 'foi bloqueada' : 'foram bloqueadas'}. ` +
          'Deseja bloquear essas também? (isso interrompe contas em andamento)',
      );
      if (!forcar) {
        toast(`${plural(bloqueadas, 'mesa bloqueada', 'mesas bloqueadas')} — ${puladas} com conta aberta não ${puladas === 1 ? 'foi mexida' : 'foram mexidas'}.`);
        return;
      }

      const { data: r2, error: erroForcado } = await cliente.rpc('bloquear_todas_mesas', { p_forcar: true });
      if (erroForcado) {
        console.error('Erro ao forçar bloqueio de todas as mesas:', erroForcado);
        window.alert('Não foi possível bloquear as mesas restantes agora. Verifique sua conexão e tente de novo.');
        return;
      }
      await recarregarSilencioso();
      const n = (r2 as { bloqueadas: number }).bloqueadas;
      toast(`${plural(n, 'mesa bloqueada', 'mesas bloqueadas')} (incluindo com conta aberta).`);
    } finally {
      setOcupado(null);
    }
  }, [cliente, recarregarSilencioso, toast]);

  return { mesas, ocupado, carregar, atualizarLocal, liberar, desativar, ativar, liberarTodas, bloquearTodas };
}

export type ControleMesas = ReturnType<typeof useControleMesas>;
