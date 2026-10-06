import type { CardapioApi } from '../model/api';
import type { ArmazenamentoLocal } from '../model/armazenamento';
import { adicionarItem, alterarQuantidade, removerItem, totalCarrinho, totalItens, type ItemCarrinho } from '../model/carrinho';
import type { AcessoMesa, Categoria, ProdutoMenu } from '../model/types';
import type { SessaoViewModel } from './SessaoViewModel';
import { ViewModel } from './ViewModel';

export interface EstadoCardapio {
  produtos: ProdutoMenu[];
  carregandoMenu: boolean;
  erroMenu: boolean;
  carrinho: ItemCarrinho[];
  carrinhoAberto: boolean;
  enviando: boolean;
  /** Pedido enviado com sucesso (a View mostra a confirmação e chama `dispensarConfirmacao`). */
  confirmado: boolean;
  clienteNome: string;
  nomeAberto: boolean;
  aviso: { id: number; texto: string } | null;
}

export const NOME_MAX = 20;

export class CardapioViewModel extends ViewModel<EstadoCardapio> {
  private clienteIdCache: string | null = null;
  private seqAviso = 0;

  constructor(
    private readonly acesso: AcessoMesa,
    private readonly api: CardapioApi,
    private readonly armazenamento: ArmazenamentoLocal,
    private readonly sessao: SessaoViewModel,
  ) {
    super({
      produtos: [],
      carregandoMenu: false,
      erroMenu: false,
      carrinho: [],
      carrinhoAberto: false,
      enviando: false,
      confirmado: false,
      clienteNome: '',
      nomeAberto: false,
      aviso: null,
    });
  }

  private avisar(texto: string) {
    this.setState({ aviso: { id: ++this.seqAviso, texto } });
  }

  async clienteId() {
    this.clienteIdCache ??= await this.armazenamento.clienteId();
    return this.clienteIdCache;
  }

  /** Chamado quando a sessão libera o cardápio: só então carrega o menu e pede o nome. */
  async aoLiberar() {
    const clienteNome = await this.armazenamento.lerNome();
    this.setState({ clienteNome, nomeAberto: !clienteNome });
    await this.carregarMenu();
  }

  async carregarMenu() {
    this.setState({ carregandoMenu: true, erroMenu: false });
    try {
      this.setState({ produtos: await this.api.produtos(), carregandoMenu: false });
    } catch (erro) {
      console.warn('Erro ao carregar cardápio:', erro);
      this.setState({ carregandoMenu: false, erroMenu: true });
    }
  }

  porCategoria(categoria: Categoria): ProdutoMenu[] {
    return this.getState().produtos.filter((p) => p.categoria === categoria);
  }

  // ---- nome ----
  abrirNome() {
    this.setState({ nomeAberto: true });
  }

  fecharNome() {
    // Sem nome ainda é obrigatório: não deixa cancelar.
    if (this.getState().clienteNome) this.setState({ nomeAberto: false });
  }

  async confirmarNome(nome: string): Promise<boolean> {
    const limpo = nome.trim().slice(0, NOME_MAX);
    if (!limpo) return false;
    this.setState({ clienteNome: limpo, nomeAberto: false });
    await this.armazenamento.gravarNome(limpo);
    return true;
  }

  // ---- carrinho ----
  /** Essências não têm preço próprio: entram no carrinho com preço 0. */
  adicionar(produto: ProdutoMenu, compartilhado = false) {
    const preco = produto.categoria === 'essencia' ? 0 : produto.preco;
    const dividir = produto.categoria === 'narguile' ? compartilhado : false;
    this.setState({ carrinho: adicionarItem(this.getState().carrinho, produto.id, produto.nome, preco, dividir), carrinhoAberto: true });
  }

  alterarQuantidade(item: ItemCarrinho, delta: number) {
    this.setState({ carrinho: alterarQuantidade(this.getState().carrinho, item.produtoId, item.compartilhado, delta) });
  }

  remover(item: ItemCarrinho) {
    this.setState({ carrinho: removerItem(this.getState().carrinho, item.produtoId, item.compartilhado) });
  }

  abrirCarrinho() {
    this.setState({ carrinhoAberto: true });
  }

  fecharCarrinho() {
    this.setState({ carrinhoAberto: false });
  }

  get total() {
    return totalCarrinho(this.getState().carrinho);
  }

  get quantidadeTotal() {
    return totalItens(this.getState().carrinho);
  }

  dispensarConfirmacao() {
    this.setState({ confirmado: false });
  }

  async fazerPedido() {
    const { carrinho, clienteNome, enviando } = this.getState();
    if (enviando) return;
    if (carrinho.length === 0) {
      this.avisar('Adicione pelo menos um item antes de fazer o pedido.');
      return;
    }
    if (!clienteNome) {
      this.setState({ nomeAberto: true });
      this.avisar('Informe seu nome antes de fazer o pedido.');
      return;
    }

    this.setState({ enviando: true });
    try {
      await this.api.criarPedido({
        acesso: this.acesso,
        itens: carrinho,
        clienteNome,
        clienteId: await this.clienteId(),
        tokenSessao: this.sessao.getState().tokenSessao,
      });
      this.setState({ enviando: false, carrinhoAberto: false, confirmado: true, carrinho: [] });
    } catch (erro) {
      this.setState({ enviando: false });
      // Sessão encerrada / mesa bloqueada travam a tela; o carrinho fica como está.
      if (await this.sessao.tratarErro(erro)) return;
      // O carrinho é mantido de propósito — o cliente não perde o que já tinha escolhido.
      this.avisar((erro as Error).message || 'O pedido NÃO foi enviado. Verifique sua conexão e tente de novo.');
    }
  }
}
