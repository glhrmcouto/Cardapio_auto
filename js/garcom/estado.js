// Estado compartilhado entre os módulos da tela do garçom.
export const estado = {
  // Papel de quem logou (garcom, balcao ou admin), guardado pra decidir, na
  // hora de desenhar os cards de mesa, se mostra o botão "Novo pedido" — essa
  // ação (lançar pedido sem QR) é restrita ao papel garcom mesmo (nem balcao
  // nem admin, ver supabase/024_lancar_pedido_garcom.sql e _exigir_garcom()
  // lá dentro). Isso aqui é só UX (esconder um botão que ia dar erro); a
  // restrição de verdade é sempre no banco, dentro da RPC.
  papelUsuario: null,
  mesasAtivas: [], // sessões com status 'aberta' — uma por mesa ocupada agora
  pedidosGarcom: [], // pedidos tipo='pedido' status='pendente', cada um já com .itens embutido
};
