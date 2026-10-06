import type { CardapioApi } from '../model/api';
import { arredondar2, formatarPreco } from '../model/formatar';
import type { AcessoMesa, ContaCliente } from '../model/types';
import type { SessaoViewModel } from './SessaoViewModel';
import { ViewModel } from './ViewModel';

export interface EstadoConta {
  aberta: boolean;
  /** Texto de status enquanto não há conta (consultando / erro). */
  status: string | null;
  conta: ContaCliente | null;
  aceitaTaxa: boolean;
  fechandoParte: boolean;
  fechandoConta: boolean;
  aviso: { id: number; texto: string } | null;
}

export class ContaViewModel extends ViewModel<EstadoConta> {
  private seqAviso = 0;

  constructor(
    private readonly acesso: AcessoMesa,
    private readonly api: CardapioApi,
    private readonly sessao: SessaoViewModel,
    private readonly clienteId: () => Promise<string>,
  ) {
    super({ aberta: false, status: null, conta: null, aceitaTaxa: true, fechandoParte: false, fechandoConta: false, aviso: null });
  }

  private avisar(texto: string) {
    this.setState({ aviso: { id: ++this.seqAviso, texto } });
  }

  async abrir() {
    this.setState({ aberta: true, aceitaTaxa: true });
    await this.carregar();
  }

  fechar() {
    this.setState({ aberta: false, conta: null, status: null });
  }

  async carregar() {
    this.setState({ status: 'Consultando conta...', conta: null });
    try {
      const conta = await this.api.conta({ acesso: this.acesso, clienteId: await this.clienteId(), tokenSessao: this.sessao.getState().tokenSessao });
      this.setState({ conta, status: null });
    } catch (erro) {
      if (await this.sessao.tratarErro(erro)) {
        this.fechar();
        return;
      }
      this.setState({ status: (erro as Error).message || 'Não foi possível consultar a conta agora. Verifique sua conexão e tente de novo.' });
    }
  }

  definirAceitaTaxa(aceita: boolean) {
    this.setState({ aceitaTaxa: aceita });
  }

  /** Valores exibidos em "Minha parte": a taxa é só uma prévia; o servidor recalcula ao fechar. */
  get previaMinhaParte() {
    const { conta, aceitaTaxa } = this.getState();
    const subtotal = conta?.minha_parte.subtotal_em_aberto ?? 0;
    const taxa = aceitaTaxa ? arredondar2((subtotal * (conta?.taxa_servico_percentual ?? 0)) / 100) : 0;
    return { subtotal, taxa, total: arredondar2(subtotal + taxa) };
  }

  /** A View pede a confirmação ao usuário ANTES de chamar. */
  async fecharMinhaParte() {
    const { fechandoParte, aceitaTaxa } = this.getState();
    if (fechandoParte) return;
    this.setState({ fechandoParte: true });
    try {
      const r = await this.api.fecharMinhaParte({ acesso: this.acesso, clienteId: await this.clienteId(), aceitaTaxa });
      this.setState({ fechandoParte: false });
      this.avisar(`Sua parte (${formatarPreco(r.valor_total)}) foi enviada ao balcão. Aguarde o garçom.`);
      await this.carregar();
    } catch (erro) {
      this.setState({ fechandoParte: false });
      this.avisar((erro as Error).message || 'Não foi possível fechar sua parte agora. Verifique sua conexão e tente de novo.');
    }
  }

  async fecharContaToda() {
    if (this.getState().fechandoConta) return;
    this.setState({ fechandoConta: true });
    try {
      await this.api.fecharContaToda({ acesso: this.acesso, tokenSessao: this.sessao.getState().tokenSessao });
      this.setState({ fechandoConta: false });
      this.fechar();
      this.avisar('Pedido de fechamento enviado! O garçom já foi avisado.');
    } catch (erro) {
      this.setState({ fechandoConta: false });
      if (await this.sessao.tratarErro(erro)) {
        this.fechar();
        return;
      }
      this.avisar((erro as Error).message || 'Não foi possível enviar o pedido de fechamento. Verifique sua conexão e tente de novo.');
    }
  }
}
