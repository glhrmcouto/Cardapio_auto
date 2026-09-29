// Estado compartilhado entre os módulos do balcão — cada lista é mantida em
// sincronia com o banco pela carga inicial (carregamento.js), pelas ações do
// garçom e pelo Realtime (realtime.js).
export const estado = {
  pedidos: [], // só os pedidos com status "pendente" — cada um já vem com .itens embutido
  fechamentos: [], // pedidos de "fechar conta" (mesa inteira) ainda não atendidos
  pagamentosPendentes: [], // pagamentos parciais ("fechar minha parte") ainda não confirmados
  mesasAtivas: [], // sessões com status "aberta" — uma por mesa ocupada agora
};
