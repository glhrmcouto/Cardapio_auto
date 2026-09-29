import JSZip from 'jszip';
import { supabase } from './supabase';
import { formatarDataISO, formatarPreco, LABEL_CATEGORIA } from './shared';
import type { Categoria } from './types';

const TAMANHO_PAGINA = 1000; // limite padrão de linhas por resposta do PostgREST

type Linha = Record<string, unknown>;
type LinhaCsv = Record<string, string | number>;

async function buscarTabelaCompleta(tabela: string, colunaOrdenacao: string): Promise<Linha[]> {
  let registros: Linha[] = [];
  for (let pagina = 0; ; pagina++) {
    const inicio = pagina * TAMANHO_PAGINA;
    const { data, error } = await supabase
      .from(tabela)
      .select('*')
      .order(colunaOrdenacao)
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    registros = registros.concat(data as Linha[]);
    if (data.length < TAMANHO_PAGINA) break;
  }
  return registros;
}

const TIPO_PEDIDO_LABEL: Record<string, string> = { pedido: 'Pedido', fechar_conta: 'Fechar conta' };
const STATUS_PEDIDO_LABEL: Record<string, string> = { pendente: 'Pendente', entregue: 'Entregue', finalizado: 'Finalizado' };
const ORIGEM_PEDIDO_LABEL: Record<string, string> = { cliente: 'Cliente (QR code)', garcom: 'Garçom' };

function dataHoraCsv(iso: unknown): string {
  if (!iso) return '';
  return new Date(String(iso))
    .toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '');
}

function simNao(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return valor ? 'Sim' : 'Não';
}

const str = (v: unknown) => String(v ?? '');
const num = (v: unknown) => Number(v);

function linhasProdutos(produtos: Linha[]): LinhaCsv[] {
  return produtos.map((p) => ({
    ID: num(p.id),
    Nome: str(p.nome),
    Descrição: str(p.descricao),
    Preço: formatarPreco(num(p.preco)),
    Categoria: LABEL_CATEGORIA[p.categoria as Categoria] || str(p.categoria),
    Ativo: simNao(p.ativo),
    Ordem: num(p.ordem),
  }));
}

function linhasPedidos(pedidos: Linha[]): LinhaCsv[] {
  return pedidos.map((p) => ({
    ID: str(p.id),
    Tipo: TIPO_PEDIDO_LABEL[str(p.tipo)] || str(p.tipo),
    Mesa: num(p.mesa),
    Cliente: str(p.cliente_nome),
    Total: formatarPreco(num(p.total)),
    Status: STATUS_PEDIDO_LABEL[str(p.status)] || str(p.status),
    Origem: ORIGEM_PEDIDO_LABEL[str(p.origem)] || str(p.origem),
    'Data/Hora': dataHoraCsv(p.criado_em),
  }));
}

function linhasPedidoItens(itens: Linha[], pedidos: Linha[]): LinhaCsv[] {
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  return itens.map((item) => {
    const pedido = porId.get(item.pedido_id);
    return {
      'ID Item': num(item.id),
      'ID Pedido': str(item.pedido_id),
      Mesa: pedido ? num(pedido.mesa) : '',
      'Data/Hora do Pedido': pedido ? dataHoraCsv(pedido.criado_em) : '',
      'Status do Pedido': pedido ? STATUS_PEDIDO_LABEL[str(pedido.status)] || str(pedido.status) : '',
      Produto: str(item.nome_snapshot),
      'Preço Unitário': formatarPreco(num(item.preco_unitario)),
      Quantidade: num(item.quantidade),
      Subtotal: formatarPreco(num(item.preco_unitario) * num(item.quantidade)),
      Compartilhado: simNao(item.compartilhado),
    };
  });
}

const COLUNAS_VAZIO: Record<string, string[]> = {
  produtos: ['ID', 'Nome', 'Descrição', 'Preço', 'Categoria', 'Ativo', 'Ordem'],
  pedidos: ['ID', 'Tipo', 'Mesa', 'Cliente', 'Total', 'Status', 'Origem', 'Data/Hora'],
  pedido_itens: ['ID Item', 'ID Pedido', 'Mesa', 'Data/Hora do Pedido', 'Status do Pedido', 'Produto', 'Preço Unitário', 'Quantidade', 'Subtotal', 'Compartilhado'],
};

function campoCsv(valor: string | number): string {
  const texto = String(valor ?? '');
  return /[;",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function paraCsv(linhas: LinhaCsv[], tabela: string): string {
  const colunas = linhas.length > 0 ? Object.keys(linhas[0]) : COLUNAS_VAZIO[tabela];
  const corpo = linhas.map((l) => colunas.map((c) => campoCsv(l[c])).join(';')).join('\r\n');
  return '﻿' + colunas.join(';') + (corpo ? '\r\n' + corpo : '');
}

export function baixarArquivo(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

/** Gera e baixa o .zip com backup.json + CSVs legíveis de produtos, pedidos e itens. */
export async function baixarBackupCompleto() {
  const [produtos, pedidos, pedidoItens] = await Promise.all([
    buscarTabelaCompleta('produtos', 'id'),
    buscarTabelaCompleta('pedidos', 'id'),
    buscarTabelaCompleta('pedido_itens', 'id'),
  ]);

  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify({ gerado_em: new Date().toISOString(), produtos, pedidos, pedido_itens: pedidoItens }, null, 2));
  zip.file('produtos.csv', paraCsv(linhasProdutos(produtos), 'produtos'));
  zip.file('pedidos.csv', paraCsv(linhasPedidos(pedidos), 'pedidos'));
  zip.file('pedido_itens.csv', paraCsv(linhasPedidoItens(pedidoItens, pedidos), 'pedido_itens'));

  baixarArquivo(await zip.generateAsync({ type: 'blob' }), `backup-aooba_${formatarDataISO(new Date())}.zip`);
}
