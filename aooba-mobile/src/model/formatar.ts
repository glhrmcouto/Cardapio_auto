import type { Categoria, StatusPessoa } from './types';

/**
 * Formata em BRL sem depender de Intl/toLocaleString (o suporte do Hermes varia por plataforma).
 * Ex.: 1234.5 -> "R$ 1.234,50".
 */
export function formatarPreco(valor: number | string): string {
  const n = Number(valor);
  const negativo = n < 0;
  const [inteiro, centavos] = Math.abs(n).toFixed(2).split('.');
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}R$ ${comMilhar},${centavos}`;
}

export function arredondar2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export const LABEL_CATEGORIA: Record<Categoria, string> = {
  drink: 'Drinks',
  cerveja: 'Cervejas',
  sem_alcool: 'Sem Álcool',
  narguile: 'Narguilé',
  essencia: 'Essências',
};

export const ORDEM_CATEGORIAS: Categoria[] = ['drink', 'cerveja', 'sem_alcool', 'narguile', 'essencia'];

export const STATUS_LABEL_PESSOA: Record<StatusPessoa, string> = {
  em_aberto: 'Em aberto',
  aguardando: 'Aguardando',
  pago: 'Pago',
};
