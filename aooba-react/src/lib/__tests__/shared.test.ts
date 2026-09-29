import { arredondar2, formatarDataISO, formatarPreco, montarUrlMesa } from '../shared';

describe('shared', () => {
  it('formata preço em BRL', () => {
    expect(formatarPreco(12.5).replace(/\s/g, ' ')).toBe('R$ 12,50');
    expect(formatarPreco('0').replace(/\s/g, ' ')).toBe('R$ 0,00');
  });

  it('formata data local yyyy-mm-dd (sem virar o dia por UTC)', () => {
    expect(formatarDataISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(formatarDataISO(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('arredonda para 2 casas como o banco', () => {
    expect(arredondar2(1.005)).toBe(1.01);
    expect(arredondar2(10.999)).toBe(11);
  });

  it('monta a URL do QR da mesa com número e token', () => {
    expect(montarUrlMesa({ numero: 7, token: 'abc' })).toBe(`${window.location.origin}/?mesa=7&t=abc`);
  });
});
