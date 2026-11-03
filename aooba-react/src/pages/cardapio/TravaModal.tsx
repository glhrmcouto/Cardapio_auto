import { useState } from 'react';
import { lerClienteNome } from '../../lib/sessaoCliente';
import type { SessaoCliente, TelaSessao } from './useSessao';

const NOME_MAX = 20;

interface Props {
  sessao: SessaoCliente;
  mesa: string;
}

interface Conteudo {
  titulo: string;
  texto: string;
  botoes: ('cancelar' | 'entrar' | 'iniciar')[];
}

function conteudoBloqueio(mesa: string, sessao: SessaoCliente): Conteudo {
  if (sessao.solicitacao === 'pendente') {
    return { titulo: 'Aguardando o garçom', texto: `${sessao.nomeSolicitado}, o garçom vai confirmar que você está na Mesa ${mesa}. Esta tela atualiza sozinha.`, botoes: [] };
  }
  if (sessao.solicitacao === 'recusada') {
    return { titulo: 'Pedido não aprovado', texto: 'O garçom não confirmou sua presença nesta mesa. Chame um atendente ou tente de novo.', botoes: [] };
  }
  return { titulo: 'Mesa aguardando liberação', texto: `Diga seu nome para o garçom confirmar que você está na Mesa ${mesa}.`, botoes: [] };
}

function conteudoDaTela(tela: TelaSessao, mesa: string, sessao: SessaoCliente): Conteudo | null {
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
      return conteudoBloqueio(mesa, sessao);
    default:
      return null; // 'carregando' e 'liberada' não travam a tela
  }
}

/** Modal de trava: quatro estados com o mesmo visual (acesso, boas-vindas, encerrada, confirmar entrada). */
export function TravaModal({ sessao, mesa }: Props) {
  const conteudo = conteudoDaTela(sessao.tela, mesa, sessao);
  const aberto = conteudo !== null;
  // null = a pessoa ainda não digitou: vale o nome lembrado neste navegador.
  const [digitado, setNome] = useState<string | null>(null);
  const nome = digitado ?? lerClienteNome();
  // Só pede o nome enquanto não há pedido na fila (ou depois de uma recusa).
  const pedeNome = sessao.tela === 'mesa_bloqueada' && sessao.solicitacao !== 'pendente';

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
        {pedeNome && (
          <form
            className="trava-liberacao"
            onSubmit={(e) => {
              e.preventDefault();
              void sessao.pedirLiberacao(nome);
            }}
          >
            <input
              className="nome-modal__input"
              type="text"
              value={nome}
              maxLength={NOME_MAX}
              placeholder="Seu nome. Ex: João"
              aria-label="Seu nome"
              autoComplete="off"
              onChange={(e) => setNome(e.target.value)}
            />
            <div className="modal-panel__acoes">
              <button type="submit" className="btn btn--primary" disabled={sessao.enviandoSolicitacao || !nome.trim()}>
                {sessao.enviandoSolicitacao ? 'Enviando...' : sessao.solicitacao === 'recusada' ? 'Tentar de novo' : 'Pedir liberação'}
              </button>
            </div>
          </form>
        )}
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
