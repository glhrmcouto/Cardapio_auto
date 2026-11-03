import { ehMesaBloqueada, ehSessaoEncerrada, ErroApi, type CardapioApi } from '../model/api';
import type { ArmazenamentoLocal } from '../model/armazenamento';
import { decidirComSessao, decidirSemSessao, type SessaoGuardada } from '../model/regrasSessao';
import type { AcessoMesa, SessaoAtual } from '../model/types';
import { ViewModel } from './ViewModel';

/**
 * Telas do cardápio, conforme a sessão da mesa:
 *  carregando        — consultando o servidor;
 *  sem_conexao       — não deu para confirmar a mesa (rede/servidor): tenta de novo, não libera;
 *  qr_invalido       — o servidor recusou mesa/token: escanear de novo;
 *  boas_vindas       — mesa livre, cliente novo ("Iniciar pedido");
 *  conta_encerrada   — este aparelho tinha sessão que já fechou;
 *  confirmar_entrada — já há sessão aberta e este aparelho não a tinha ("Entrar na conta");
 *  entrada_cancelada — a pessoa recusou entrar;
 *  mesa_bloqueada    — aguardando liberação do garçom (polling); a pessoa informa o nome e o garçom
 *                      confirma que ela está na mesa (fila de aprovação, ver `solicitacao`);
 *  liberada          — pode pedir.
 */
export type TelaSessao = 'carregando' | 'sem_conexao' | 'qr_invalido' | 'boas_vindas' | 'conta_encerrada' | 'confirmar_entrada' | 'entrada_cancelada' | 'mesa_bloqueada' | 'liberada';

/** 'scan' = a pessoa acabou de ler o QR (começo explícito); 'retomada' = reabrindo a tela. */
export type OrigemAcesso = 'scan' | 'retomada';

export interface EstadoSessao {
  tela: TelaSessao;
  sessaoId: string | null;
  tokenSessao: string | null;
  abrindo: boolean;
  /**
   * Fila de aprovação (só na tela `mesa_bloqueada`): null = ainda não pediu; 'pendente' = o garçom vai
   * confirmar que `nomeSolicitado` está na mesa; 'recusada' = o garçom não confirmou.
   */
  solicitacao: 'pendente' | 'recusada' | null;
  nomeSolicitado: string;
  /** Nome lembrado no aparelho, para pré-preencher o pedido de liberação. */
  nomeSugerido: string;
  enviandoSolicitacao: boolean;
  /** Mensagem passageira para a View mostrar (toast). `id` muda a cada aviso novo. */
  aviso: { id: number; texto: string } | null;
}

/** Mesa/token recusados pelo servidor (erro de regra), diferente de rede fora do ar. */
const erroDeQr = (e: unknown) => e instanceof ErroApi && (e.codigo === 'ERRO_NEGOCIO' || e.codigo === 'DADOS_INVALIDOS');

/** Mesmo limite do nome no pedido e da `solicitar_entrada` no banco. */
const NOME_MAX_SOLICITACAO = 20;

export const INTERVALO_POLL_BLOQUEADA_MS = 8000;
export const INTERVALO_POLL_SESSAO_MS = 10000;

export class SessaoViewModel extends ViewModel<EstadoSessao> {
  private pendente: SessaoAtual | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seqAviso = 0;

  constructor(
    private readonly acesso: AcessoMesa,
    private readonly api: CardapioApi,
    private readonly armazenamento: ArmazenamentoLocal,
  ) {
    super({
      tela: 'carregando',
      sessaoId: null,
      tokenSessao: null,
      abrindo: false,
      solicitacao: null,
      nomeSolicitado: '',
      nomeSugerido: '',
      enviandoSolicitacao: false,
      aviso: null,
    });
  }

  private avisar(texto: string) {
    this.setState({ aviso: { id: ++this.seqAviso, texto } });
  }

  private pararPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private ir(tela: TelaSessao) {
    this.pararPolling();
    this.setState({ tela, sessaoId: null, tokenSessao: null, solicitacao: null, nomeSolicitado: '' });
    if (tela === 'mesa_bloqueada') {
      this.timer = setInterval(() => void this.checarLiberacao(), INTERVALO_POLL_BLOQUEADA_MS);
      void this.retomarSolicitacao();
    }
  }

  /** Reabrir a tela não perde o pedido que já está na fila do garçom; erro de rede só deixa sem retomar. */
  private async retomarSolicitacao() {
    try {
      const nomeSugerido = await this.armazenamento.lerNome();
      const status = await this.api.statusSolicitacao(this.acesso, await this.armazenamento.clienteId());
      if (this.getState().tela !== 'mesa_bloqueada') return;
      this.setState(status === 'pendente' ? { nomeSugerido, solicitacao: 'pendente', nomeSolicitado: nomeSugerido } : { nomeSugerido });
    } catch (erro) {
      console.warn('Erro ao retomar o pedido de liberação:', erro);
    }
  }

  /** Pede ao garçom para confirmar que `nome` está na mesa (fila de aprovação). */
  async pedirLiberacao(nome: string) {
    const limpo = nome.trim();
    if (this.getState().enviandoSolicitacao) return;
    if (!limpo || limpo.length > NOME_MAX_SOLICITACAO) {
      this.avisar(`Informe seu nome (até ${NOME_MAX_SOLICITACAO} caracteres).`);
      return;
    }
    this.setState({ enviandoSolicitacao: true });
    try {
      const status = await this.api.solicitarEntrada(this.acesso, { clienteId: await this.armazenamento.clienteId(), nome: limpo });
      await this.armazenamento.gravarNome(limpo);
      if (status === 'aprovada') {
        await this.iniciar('retomada'); // a mesa já estava liberada
      } else {
        this.setState({ solicitacao: 'pendente', nomeSolicitado: limpo });
      }
    } catch (erro) {
      this.avisar((erro as Error).message || 'Não foi possível pedir a liberação agora. Tente de novo.');
    } finally {
      this.setState({ enviandoSolicitacao: false });
    }
  }

  private async liberar(sessao: SessaoAtual) {
    this.pararPolling();
    await this.armazenamento.gravarSessao(this.acesso.mesa, sessao.sessao_id, sessao.token_sessao);
    await this.armazenamento.limparEncerrada();
    this.setState({ tela: 'liberada', sessaoId: sessao.sessao_id, tokenSessao: sessao.token_sessao });
    this.timer = setInterval(() => void this.checarSessaoViva(), INTERVALO_POLL_SESSAO_MS);
  }

  /** Checagem inicial: sempre reconferida com o servidor. Na dúvida, TRAVA (nunca libera às cegas). */
  async iniciar(origem: OrigemAcesso = 'retomada') {
    this.pararPolling();
    this.pendente = null;
    this.setState({ tela: 'carregando' });

    const guardada = await this.armazenamento.lerSessao(this.acesso.mesa);
    // Ler o QR de novo é um começo explícito: esquece "conta encerrada" de antes (a tela manda escanear de novo).
    if (origem === 'scan') await this.armazenamento.limparEncerrada();

    try {
      const atual = await this.api.sessaoAtual(this.acesso);
      if (atual) {
        if (decidirComSessao(atual, guardada) === 'entrar') {
          await this.liberar(atual);
        } else {
          this.pendente = atual;
          this.ir('confirmar_entrada');
        }
        return;
      }
      await this.semSessao(origem === 'scan' ? null : guardada);
    } catch (erro) {
      console.warn('Erro ao consultar a mesa:', erro);
      this.ir(erroDeQr(erro) ? 'qr_invalido' : 'sem_conexao');
    }
  }

  private async semSessao(guardada: SessaoGuardada | null) {
    const statusMesa = await this.api.statusMesa(this.acesso); // se falhar, o catch de iniciar() trava
    const marca = await this.armazenamento.lerEncerrada(this.acesso.mesa);
    const decisao = decidirSemSessao({ statusMesa, guardada, marca });
    if (decisao.tela === 'conta_encerrada') {
      await this.mostrarContaFechada(decisao.sessaoIdEncerrada);
      return;
    }
    if (decisao.tela === 'mesa_bloqueada') await this.armazenamento.limparSessao();
    this.ir(decisao.tela);
  }

  /** Chamada quando o servidor recusa por SESSAO_ENCERRADA ou o polling percebe que a conta fechou. */
  async mostrarContaFechada(sessaoIdEncerrada: string | null) {
    this.pendente = null;
    await this.armazenamento.marcarEncerrada(this.acesso.mesa, sessaoIdEncerrada);
    await this.armazenamento.limparSessao();
    this.ir('conta_encerrada');
  }

  async mostrarMesaBloqueada() {
    this.pendente = null;
    await this.armazenamento.limparSessao();
    this.ir('mesa_bloqueada');
  }

  /** Único caminho de CRIAÇÃO de sessão — só sob toque explícito em "Iniciar pedido". */
  async iniciarPedido() {
    if (this.getState().abrindo) return;
    this.setState({ abrindo: true });
    try {
      await this.liberar(await this.api.abrirSessao(this.acesso));
    } catch (erro) {
      if (ehMesaBloqueada(erro)) {
        await this.mostrarMesaBloqueada();
      } else {
        this.avisar((erro as Error).message || 'Não foi possível iniciar o pedido agora. Verifique sua conexão e tente de novo.');
      }
    } finally {
      this.setState({ abrindo: false });
    }
  }

  /** "Entrar na conta": adota o token vigente já vindo de sessaoAtual. */
  async entrarNaSessao() {
    const pendente = this.pendente;
    if (!pendente) return;
    this.pendente = null;
    await this.liberar(pendente);
  }

  async cancelarEntrada() {
    this.pendente = null;
    this.ir('entrada_cancelada');
  }

  /** A View e os outros ViewModels reportam erros do servidor aqui. Devolve true se tratou. */
  async tratarErro(erro: unknown): Promise<boolean> {
    if (ehSessaoEncerrada(erro)) {
      await this.mostrarContaFechada(this.getState().sessaoId);
      return true;
    }
    if (ehMesaBloqueada(erro)) {
      await this.mostrarMesaBloqueada();
      return true;
    }
    return false;
  }

  private async checarLiberacao() {
    try {
      if ((await this.api.statusMesa(this.acesso)) === 'liberada') {
        await this.iniciar('retomada');
        return;
      }
      if (this.getState().solicitacao === 'pendente') {
        const status = await this.api.statusSolicitacao(this.acesso, await this.armazenamento.clienteId());
        if (status === 'recusada' && this.getState().solicitacao === 'pendente') this.setState({ solicitacao: 'recusada' });
      }
    } catch (erro) {
      console.warn('Erro ao checar liberação da mesa:', erro);
    }
  }

  /** Substitui o Realtime do original: só conforto; a defesa real é o token de sessão no servidor. */
  private async checarSessaoViva() {
    const { sessaoId } = this.getState();
    if (!sessaoId) return;
    try {
      const atual = await this.api.sessaoAtual(this.acesso);
      // Só reage a resposta CONFIRMADA: erro de rede não derruba a tela.
      if (!atual || atual.sessao_id !== sessaoId) await this.mostrarContaFechada(sessaoId);
    } catch (erro) {
      console.warn('Erro ao conferir a sessão:', erro);
    }
  }

  override dispose() {
    this.pararPolling();
  }
}
