import { useCallback, useRef, useState } from 'react';

export type TipoBeep = 'pedido' | 'fechamento';

function tocarTom(ctx: AudioContext, frequencia: number, atraso: number, duracao: number) {
  const inicio = ctx.currentTime + atraso;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequencia;
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao);
}

/** Beep de novo pedido/fechamento — só toca depois que o usuário ativa (política de autoplay). */
export function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);
  const ativoRef = useRef(false);
  const [somAtivo, setSomAtivo] = useState(false);
  const [avisoVisivel, setAvisoVisivel] = useState(false);

  const obterCtx = () => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new Ctor();
    }
    return ctxRef.current;
  };

  const tocar = useCallback((tipo: TipoBeep = 'pedido') => {
    if (!ativoRef.current) {
      setAvisoVisivel(true);
      return;
    }
    const ctx = obterCtx();
    if (tipo === 'fechamento') {
      tocarTom(ctx, 440, 0, 0.16);
      tocarTom(ctx, 440, 0.22, 0.16);
    } else {
      tocarTom(ctx, 880, 0, 0.18);
    }
  }, []);

  const alternar = useCallback(async () => {
    if (ativoRef.current) {
      ativoRef.current = false;
      setSomAtivo(false);
      return;
    }
    const ctx = obterCtx();
    await ctx.resume();
    ativoRef.current = true;
    setSomAtivo(true);
    setAvisoVisivel(false);
    tocarTom(ctx, 880, 0, 0.18);
  }, []);

  return { somAtivo, avisoVisivel, tocar, alternar };
}
