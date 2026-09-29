// ========================================
// AVISO DE SEM CONEXÃO
// ========================================
//
// navigator.onLine reflete a interface de rede do aparelho (wifi/dados),
// não se o Supabase especificamente está no ar — mas cobre o caso mais comum
// no salão de um bar (celular do cliente perdendo sinal), e o pedido em si
// já tem seu próprio aviso de erro se falhar por outro motivo (ver fazerPedido).

const offlineAvisoEl = document.getElementById('offlineAviso');

function atualizarAvisoOffline() {
  const offline = !navigator.onLine;
  offlineAvisoEl.classList.toggle('show', offline);
  document.body.classList.toggle('is-offline', offline);
}

// Mede a altura real do aviso (ele nunca sai do fluxo com display:none, só
// desliza pra fora da tela — ver .offline-aviso em style.css), pra barra da
// mesa/header descerem exatamente o espaço certo, mesmo se o texto quebrar
// em duas linhas numa tela estreita.
function medirAlturaOffline() {
  document.documentElement.style.setProperty('--offline-altura', `${offlineAvisoEl.offsetHeight}px`);
}

window.addEventListener('online', atualizarAvisoOffline);
window.addEventListener('offline', atualizarAvisoOffline);
window.addEventListener('resize', medirAlturaOffline);
medirAlturaOffline();
atualizarAvisoOffline();
