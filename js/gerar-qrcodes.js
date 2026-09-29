// ========================================
// GERAR QR CODES — um QR por mesa ativa, direto da tabela "mesas"
// ========================================
//
// Mesmo login e checagem de papel admin do admin.html (ver
// supabase/003_admin.sql) — sem isso ninguém, nem "authenticated" sem
// papel admin, consegue ler a tabela "mesas" (RLS, ver
// supabase/005_seguranca.sql), então essa tela precisa do mesmo login.

import { supabase } from './supabaseClient.js';
import { configurarLogin } from './auth.js';


const qrCarregandoEl = document.getElementById('qrCarregando');
const qrErroEl = document.getElementById('qrErro');
const qrErroTextoEl = document.getElementById('qrErroTexto');
const qrTentarBtn = document.getElementById('qrTentar');
const qrVazioEl = document.getElementById('qrVazio');
const qrGrid = document.getElementById('qrGrid');
const qrImprimirBtn = document.getElementById('qrImprimirBtn');
const qrRecarregarBtn = document.getElementById('qrRecarregarBtn');

// ========================================
// MESAS -> QR CODES
// ========================================

// Mesma lógica do admin.html: monta a URL a partir do domínio onde esta
// própria página está rodando (localhost, preview do Netlify, produção...),
// sem precisar fixar domínio nenhum aqui.
function montarUrlMesa(mesa) {
  return `${window.location.origin}/index.html?mesa=${mesa.numero}&t=${mesa.token}`;
}

async function gerarQrCodes(mesas) {
  qrGrid.innerHTML = '';

  for (const mesa of mesas) {
    const url = montarUrlMesa(mesa);

    const card = document.createElement('div');
    card.className = 'qr-card';
    card.innerHTML = `
      <span class="qr-card__marca">AOOBA! BAR</span>
      <span class="qr-card__mesa-label">Mesa</span>
      <span class="qr-card__mesa-numero">${mesa.numero}</span>
      <canvas class="qr-card__canvas"></canvas>
      <p class="qr-card__instrucao">Aponte a câmera do celular<br>e peça direto pela mesa.</p>
    `;
    qrGrid.appendChild(card);

    // A URL (com o token) não aparece em texto no card impresso de propósito —
    // só o QR code carrega ela; escrever o token também em texto legível na
    // mesa seria dar de bandeja o mesmo segredo que o QR já protege.
    const canvas = card.querySelector('canvas');
    try {
      await QRCode.toCanvas(canvas, url, {
        width: 200,
        margin: 1,
        color: { dark: '#1a1a1a', light: '#ffffff' },
      });
    } catch (erro) {
      console.error(`Erro ao gerar QR code da mesa ${mesa.numero}:`, erro);
      canvas.remove();
      card.insertAdjacentHTML('beforeend', '<span class="qr-card__falha">Não foi possível gerar este QR code.</span>');
    }
  }
}

async function carregarEGerarQrCodes() {
  qrCarregandoEl.style.display = 'block';
  qrErroEl.style.display = 'none';
  qrVazioEl.style.display = 'none';
  qrGrid.innerHTML = '';

  // Checagem explícita em vez de deixar cada card falhar em silêncio um por
  // um: se o script do CDN (qrcode.min.js) não carregou — CDN fora do ar,
  // bloqueador de conteúdo, URL da versão quebrada — "QRCode" nunca existe
  // no navegador. Sem isso, o sintoma era N cards, cada um com "não foi
  // possível gerar", sem pista nenhuma do motivo real.
  if (typeof QRCode === 'undefined') {
    qrCarregandoEl.style.display = 'none';
    qrErroTextoEl.textContent = 'A biblioteca de QR code não carregou (falha ao buscar o script do CDN). Verifique sua conexão e tente de novo.';
    qrErroEl.style.display = 'block';
    return;
  }

  try {
    const { data, error } = await supabase
      .from('mesas')
      .select('numero, token, ativa')
      .eq('ativa', true)
      .order('numero');

    if (error) throw error;

    qrCarregandoEl.style.display = 'none';

    if (data.length === 0) {
      qrVazioEl.style.display = 'block';
      return;
    }

    await gerarQrCodes(data);
  } catch (erro) {
    console.error('Erro ao carregar mesas:', erro);
    qrCarregandoEl.style.display = 'none';
    qrErroTextoEl.textContent = 'Não foi possível carregar as mesas agora. Verifique sua conexão e tente de novo.';
    qrErroEl.style.display = 'block';
  }
}

qrTentarBtn.addEventListener('click', carregarEGerarQrCodes);
qrRecarregarBtn.addEventListener('click', carregarEGerarQrCodes);
qrImprimirBtn.addEventListener('click', () => window.print());

// ========================================
// BOOTSTRAP (fica por último de propósito — ver configurarLogin em auth.js)
// ========================================

await configurarLogin({
  conteudoEl: document.getElementById('qrPagina'),
  exigirAdmin: true,
  aoEntrar: carregarEGerarQrCodes,
});
