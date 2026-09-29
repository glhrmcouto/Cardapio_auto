// ========================================
// FEEDBACK DE SALVAR (sucesso/erro, some sozinho depois de alguns segundos)
// ========================================

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
