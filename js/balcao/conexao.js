const conexaoStatusEl = document.getElementById('conexaoStatus');

// ========================================
// INDICADOR DE CONEXÃO
// ========================================

let estadoRede = navigator.onLine ? 'online' : 'offline';
let estadoCanal = 'conectando';

// Chamado pelo realtime.js a cada mudança de status do canal.
export function definirEstadoCanal(status) {
  estadoCanal = status;
}

export function recalcularIndicadorConexao() {
  let estado = 'reconectando';
  if (estadoRede === 'offline') estado = 'offline';
  else if (estadoCanal === 'SUBSCRIBED') estado = 'online';
  else if (estadoCanal === 'conectando') estado = 'conectando';

  const textos = {
    online: '🟢 Online',
    conectando: '🟡 Conectando...',
    reconectando: '🟡 Reconectando...',
    offline: '🔴 Sem conexão',
  };
  conexaoStatusEl.textContent = textos[estado];
}

window.addEventListener('online', () => { estadoRede = 'online'; recalcularIndicadorConexao(); });
window.addEventListener('offline', () => { estadoRede = 'offline'; recalcularIndicadorConexao(); });

