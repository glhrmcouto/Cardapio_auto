// ========================================================================
// Funções pequenas repetidas em vários dos arquivos do site (formatação de
// preço, escape de texto pra HTML, data local em yyyy-mm-dd). Um lugar só
// pra manter, em vez de copiar/colar a mesma função em cada arquivo.
// ========================================================================

export function formatarPreco(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Taxa de serviço cobrada só no fechamento da conta (a "comanda" inteira da
// mesa), nunca em pedidos individuais — repassada à equipe, por isso fica de
// fora do faturamento de produto somado em relatorios.js (pedidos.total
// continua sendo só a soma dos itens). Mesmo valor usado no lado do
// cliente (balcao.js calcula localmente; o cardápio recebe já calculado
// pela RPC conta_da_mesa, ver supabase/006_taxa_servico.sql) — se mudar
// aqui, mude lá também.
export const TAXA_SERVICO = 0.10;

export function calcularTaxaServico(subtotal) {
  return Math.round(subtotal * TAXA_SERVICO * 100) / 100;
}

// Escapa &, < e > antes de jogar um valor em texto/atributo HTML — evita que
// um nome de produto tipo `12" Pizza & Cia` quebre o HTML do card sem
// querer. Nome/descrição vêm do banco (só admin escreve ali), mas ainda
// assim escapamos por segurança.
export function escaparTexto(valor) {
  return String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escaparAtributo(valor) {
  return escaparTexto(valor).replace(/"/g, '&quot;');
}

// Data LOCAL (não UTC) no formato yyyy-mm-dd — bate com o que um
// <input type="date"> espera e com o fuso de quem está usando o site, não
// com o de Greenwich (usar toISOString() aqui erraria o dia perto da
// meia-noite pra quem está a oeste de UTC, que é o caso do Brasil inteiro).
export function formatarDataISO(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}
