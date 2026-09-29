import type { Categoria, StatusPessoa } from './types';

export function formatarPreco(valor: number | string): string {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

// Data LOCAL (não UTC) em yyyy-mm-dd.
export function formatarDataISO(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function formatarHorario(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function montarUrlMesa(mesa: { numero: number; token: string }): string {
  return `${window.location.origin}/?mesa=${mesa.numero}&t=${mesa.token}`;
}

export function arredondar2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}
