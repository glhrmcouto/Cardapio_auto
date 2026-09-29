// ========================================================================
// Funções pequenas repetidas em vários dos arquivos do site (formatação de
// preço, escape de texto pra HTML, data local em yyyy-mm-dd, categorias,
// toast de rodapé, URL do QR da mesa). Um lugar só
// pra manter, em vez de copiar/colar a mesma função em cada arquivo.
// ========================================================================

export function formatarPreco(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Categorias de produto (mesmo check do banco, ver supabase/001_schema.sql),
// na ordem em que aparecem nos painéis.
export const LABEL_CATEGORIA = {
  drink: 'Drinks',
  cerveja: 'Cervejas',
  sem_alcool: 'Sem Álcool',
  narguile: 'Narguilé',
  essencia: 'Essências',
};
export const ORDEM_CATEGORIAS = ['drink', 'cerveja', 'sem_alcool', 'narguile', 'essencia'];

// Status de pagamento de cada pessoa na conta da mesa (ver conta_da_mesa /
// conta_da_mesa_balcao) — cardápio e balcão mostram o mesmo rótulo.
export const STATUS_LABEL_PESSOA = { em_aberto: 'Em aberto', aguardando: 'Aguardando', pago: 'Pago' };

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

// Aviso discreto no rodapé da tela (#toast, estilo .toast em css/style.css).
// O elemento é buscado na hora da chamada porque nem toda página que importa
// este arquivo tem um #toast.
let toastTimer;
export function mostrarToast(mensagem) {
  const toastEl = document.getElementById('toast');
  toastEl.textContent = mensagem;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
}

// URL exata que vira QR code de uma mesa, montada a partir do próprio domínio
// em que a página está rodando — assim funciona igual em localhost, no
// preview do Netlify e no domínio final, sem precisar fixar nada aqui. Usada
// pela página de mesas (link de cada mesa) e pelo gerador de QR codes.
export function montarUrlMesa(mesa) {
  return `${window.location.origin}/index.html?mesa=${mesa.numero}&t=${mesa.token}`;
}

// Mensagem de sucesso/erro dentro de um card dos painéis do dono (admin e
// mesas — .admin-produto-card__feedback), some sozinha depois de 4 segundos.
export function mostrarFeedback(card, mensagem, tipo) {
  const feedbackEl = card.querySelector('.admin-produto-card__feedback');
  feedbackEl.textContent = mensagem;
  feedbackEl.classList.remove('admin-produto-card__feedback--sucesso', 'admin-produto-card__feedback--erro');
  feedbackEl.classList.add(tipo === 'sucesso' ? 'admin-produto-card__feedback--sucesso' : 'admin-produto-card__feedback--erro');

  clearTimeout(feedbackEl._timer);
  feedbackEl._timer = setTimeout(() => {
    feedbackEl.textContent = '';
  }, 4000);
}
