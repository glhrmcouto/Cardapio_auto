// ========================================
// MESA (campo do número + parâmetros do QR code)
// ========================================

export const mesaInput = document.getElementById('mesaInput');
const mesaAviso = document.getElementById('mesaAviso');

// Se a página abrir com ?mesa=5&t=TOKEN na URL (QR code na mesa), pré-preenche
// o campo e TRANCA ele (readonly) — o cliente não deve poder trocar de mesa
// manualmente quando ela já veio do QR code físico da própria mesa.
//
// O token não tem campo nem UI própria: ele só existe pra ser repassado pra
// criar_pedido/pedir_fechamento (ver supabase/005_seguranca.sql), que recusam
// qualquer pedido cujo token não bata com o da mesa — sem ele (ex.: alguém
// digitando a URL só com ?mesa= manualmente, sem ter escaneado o QR físico),
// o pedido é recusado no banco, mesmo que o número da mesa exista de verdade.
const paramsUrl = new URLSearchParams(window.location.search);
const mesaDaUrl = paramsUrl.get('mesa');
export const tokenMesa = paramsUrl.get('t') || '';
if (mesaDaUrl) {
  mesaInput.value = mesaDaUrl;
  mesaInput.readOnly = true;
}

// BLOQUEIO DE ACESSO (item 3): o número da mesa é adivinhável (é só um
// inteiro pequeno na URL); o token DA MESA não (ver mesas.token em
// supabase/005_seguranca.sql). Por isso a ÚNICA forma de liberar o cardápio
// pra pedido é abrir o link do QR físico da mesa, que traz os dois:
// ?mesa=N&t=TOKEN. Sem os dois, nem tenta consultar sessão nenhuma — trava
// direto na tela "acesso bloqueado", pedindo pra escanear o QR. A validação
// de verdade continua sendo a do servidor (criar_pedido/pedir_fechamento/
// conta_da_mesa exigem e conferem o token — ver 005_seguranca.sql); isso
// aqui só evita mostrar uma UI de pedido que o banco ia recusar de
// qualquer jeito.
export const temAcessoValido = Boolean(mesaDaUrl && tokenMesa);

export function mesaAtualValor() {
  return mesaDaUrl || mesaInput.value.trim();
}

// Devolve o número da mesa do campo; se estiver vazio, mostra o aviso ao lado
// do campo, rola até ele e devolve null (usado antes de pedir e de abrir a conta).
export function exigirMesa() {
  const mesa = mesaInput.value.trim();

  if (!mesa) {
    mesaAviso.classList.add('show');
    mesaInput.focus();
    mesaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }
  mesaAviso.classList.remove('show');
  return mesa;
}

mesaInput.addEventListener('input', () => {
  if (mesaInput.value.trim()) mesaAviso.classList.remove('show');
});
