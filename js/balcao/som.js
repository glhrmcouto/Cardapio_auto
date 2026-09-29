// ========================================
// SOM (beep de pedido novo / fechamento)
// ========================================

const ativarSomBtn = document.getElementById('ativarSomBtn');
const somAvisoEl = document.getElementById('somAviso');

// Um único AudioContext reaproveitado em todos os beeps — criar um novo a cada chamada
// esgota o limite de contextos simultâneos do navegador e o áudio acaba morrendo.
let audioCtx = null;
let somAtivo = false; // true depois que o garçom ativa; volta a false se ele clicar de novo pra desativar

function obterAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Toca um único tom (Web Audio API, sem precisar de arquivo de áudio)
function tocarTom(ctx, frequencia, atraso, duracao) {
  const inicio = ctx.currentTime + atraso;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequencia;
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao);
}

// Mostra um aviso discreto no header pedindo pra ativar o som
function mostrarAvisoSom() {
  if (somAvisoEl) somAvisoEl.classList.add('show');
}

// Reflete o estado atual (ativo/desativado) no texto e no aria-pressed do botão
function atualizarBotaoSom() {
  if (!ativarSomBtn) return;
  ativarSomBtn.textContent = somAtivo ? '🔊 Som ativado' : '🔔 Ativar som';
  ativarSomBtn.setAttribute('aria-pressed', String(somAtivo));
}

// Toca o beep de "pedido novo" (agudo, único) ou de "fechar conta" (mais grave e duplo).
// Só toca se o garçom tiver ativado o som; senão mostra o aviso pra ele clicar em "Ativar som".
export function tocarBeep(tipo = 'pedido') {
  if (!somAtivo) {
    mostrarAvisoSom();
    return;
  }

  const ctx = obterAudioContext();

  if (tipo === 'fechamento') {
    tocarTom(ctx, 440, 0, 0.16);
    tocarTom(ctx, 440, 0.22, 0.16);
  } else {
    tocarTom(ctx, 880, 0, 0.18);
  }
}

// Ao clicar: se o som estava desativado, destrava o AudioContext e confirma com um beep de teste;
// se já estava ativo, apenas desativa (sem precisar suspender o contexto)
if (ativarSomBtn) {
  ativarSomBtn.addEventListener('click', () => {
    if (somAtivo) {
      somAtivo = false;
      atualizarBotaoSom();
      return;
    }

    const ctx = obterAudioContext();
    ctx.resume().then(() => {
      somAtivo = true;
      tocarTom(ctx, 880, 0, 0.18);
      atualizarBotaoSom();
      if (somAvisoEl) somAvisoEl.classList.remove('show');
    });
  });
}

