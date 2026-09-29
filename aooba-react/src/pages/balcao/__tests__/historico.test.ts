import { intervaloHistorico } from '../HistoricoModal';

describe('intervaloHistorico', () => {
  it('com data: [00:00 do dia, 00:00 do dia seguinte)', () => {
    const { inicio, fim } = intervaloHistorico('2026-03-10');
    expect(inicio).toEqual(new Date(2026, 2, 10));
    expect(fim).toEqual(new Date(2026, 2, 11));
  });

  it('virada de mês', () => {
    expect(intervaloHistorico('2026-01-31').fim).toEqual(new Date(2026, 1, 1));
  });

  it('sem data: últimos 30 dias incluindo hoje inteiro', () => {
    const agora = new Date(2026, 4, 20, 15, 30);
    const { inicio, fim } = intervaloHistorico('', agora);
    expect(fim).toEqual(new Date(2026, 4, 21, 0, 0));
    expect(inicio).toEqual(new Date(2026, 3, 21, 0, 0));
    expect(agora.getTime()).toBeLessThan(fim.getTime());
  });
});
