import type { SessaoCliente, TelaSessao } from './useSessao';

interface Props {
  sessao: SessaoCliente;
  mesa: string;
}

interface Conteudo {
  titulo: string;
  texto: string;
  botoes: ('cancelar' | 'entrar' | 'iniciar')[];
}

function conteudoDaTela(tela: TelaSessao, mesa: string): Conteudo | null {
  switch (tela) {
    case 'acesso_bloqueado':
      return { titulo: 'Conta encerrada', texto: 'Se você acabou de sentar, escaneie o QR code da mesa novamente para começar um novo pedido.', botoes: [] };
    case 'boas_vindas':
      return { titulo: 'Bem-vindo ao AOOBA! BAR', texto: `Toque abaixo para iniciar seu pedido na Mesa ${mesa}.`, botoes: ['iniciar'] };
    case 'conta_encerrada':
      return { titulo: 'Conta encerrada', texto: 'Obrigado pela visita! 🧡 Foi um prazer ter você no AOOBA! BAR.', botoes: [] };
    case 'confirmar_entrada':
      return { titulo: 'Conta encerrada', texto: `A Mesa ${mesa} já tem uma conta aberta. Deseja entrar nela para pedir junto?`, botoes: ['cancelar', 'entrar'] };
    case 'entrada_cancelada':
      return { titulo: 'Conta encerrada', texto: `Tudo bem. Se quiser pedir na Mesa ${mesa}, escaneie o QR code da mesa novamente.`, botoes: [] };
    case 'mesa_bloqueada':
      return { titulo: 'Mesa aguardando liberação', texto: 'Chame um atendente para liberar o pedido nesta mesa.', botoes: [] };
    default:
      return null; // 'carregando' e 'liberada' não travam a tela
  }
}

/** Modal de trava: quatro estados com o mesmo visual (acesso, boas-vindas, encerrada, confirmar entrada). */
export function TravaModal({ sessao, mesa }: Props) {
  const conteudo = conteudoDaTela(sessao.tela, mesa);
  const aberto = conteudo !== null;

  return (
    <>
      <div className={`modal-overlay${aberto ? ' is-open' : ''}`} />
      <div className={`modal-panel modal-panel--nome${aberto ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-labelledby="contaEncerradaTitulo">
        <div className="modal-panel__header">
          <span className="modal-panel__title" id="contaEncerradaTitulo">
            {conteudo?.titulo}
          </span>
        </div>
        <p className="nome-modal__texto">{conteudo?.texto}</p>
        {conteudo && conteudo.botoes.length > 0 && (
          <div className="modal-panel__acoes">
            {conteudo.botoes.includes('cancelar') && (
              <button type="button" className="btn btn--secondary" onClick={sessao.cancelarEntrada}>
                Cancelar
              </button>
            )}
            {conteudo.botoes.includes('entrar') && (
              <button type="button" className="btn btn--primary" onClick={sessao.entrarNaSessao}>
                Entrar na conta
              </button>
            )}
            {conteudo.botoes.includes('iniciar') && (
              <button type="button" className="btn btn--primary" disabled={sessao.abrindo} onClick={() => void sessao.iniciarPedido()}>
                {sessao.abrindo ? 'Abrindo...' : 'Iniciar pedido'}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
