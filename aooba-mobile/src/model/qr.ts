import type { AcessoMesa } from './types';

function parametrosDaQuery(texto: string): Record<string, string> {
  const inicio = texto.indexOf('?');
  if (inicio === -1) return {};
  const query = texto.slice(inicio + 1).split('#')[0];
  const out: Record<string, string> = {};
  for (const par of query.split('&')) {
    if (!par) continue;
    const igual = par.indexOf('=');
    const chave = igual === -1 ? par : par.slice(0, igual);
    const valor = igual === -1 ? '' : par.slice(igual + 1);
    try {
      out[decodeURIComponent(chave)] = decodeURIComponent(valor.replace(/\+/g, ' '));
    } catch {
      // parâmetro malformado: ignora só ele
    }
  }
  return out;
}

/**
 * Lê o conteúdo do QR da mesa. Aceita o formato dos QR já impressos
 * (`https://dominio/index.html?mesa=5&t=TOKEN`, `https://dominio/?mesa=5&t=TOKEN`) e o link do app
 * (`aooba://cardapio?mesa=5&t=TOKEN`). Qualquer outra coisa devolve null.
 * O token NÃO é validado aqui — quem valida é o servidor.
 */
export function lerQrDaMesa(conteudo: string): AcessoMesa | null {
  const { mesa, t } = parametrosDaQuery(conteudo.trim());
  if (!mesa || !t || !/^\d+$/.test(mesa)) return null;
  const numero = Number(mesa);
  if (!Number.isSafeInteger(numero) || numero <= 0) return null;
  if (/\s/.test(t)) return null;
  return { mesa: numero, token: t };
}
