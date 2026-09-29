import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Cardapio from '../Cardapio';
import { ErroPg, chamadasRpc, chamadasTabela, mockRpc, mockTabela } from '../../test/msw';
import { renderPagina } from '../../test/render';

const PRODUTOS = [
  { id: 1, nome: 'Caipirinha', descricao: 'Limão e cachaça', preco: 20, categoria: 'drink' },
  { id: 2, nome: 'Chopp', descricao: 'Gelado', preco: 12, categoria: 'cerveja' },
  { id: 3, nome: 'Suco', descricao: 'Natural', preco: 8, categoria: 'sem_alcool' },
  { id: 4, nome: 'Narguilé Duplo', descricao: 'Maçã e menta', preco: 80, categoria: 'narguile' },
  { id: 5, nome: 'Menta', descricao: 'Refrescante', preco: 0, categoria: 'essencia' },
];
const SESSAO = { sessao_id: 'ses-1', token_sessao: 'tok-sessao-1' };
const URL_MESA = '/?mesa=5&t=TOKEN-MESA';

function contaCliente(minha: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    itens: [{ nome: 'Caipirinha', preco: 20, quantidade: 2 }],
    subtotal: 40, taxa_servico_percentual: 10, taxa_servico: 4, total_geral: 44, total_pago: 0, total_pendente_confirmacao: 0, saldo_restante: 44,
    por_pessoa: [{ nome: 'João', status: 'em_aberto', valor: 44, subtotal: 40, taxa_servico: 4 }],
    minha_parte: {
      status: 'em_aberto',
      itens_diretos: [{ nome: 'Caipirinha', preco: 20, quantidade: 2, pago: false }],
      itens_compartilhados: [{ nome: 'Narguilé Duplo', valor: 40, pago: false }],
      subtotal_em_aberto: 80, subtotal_aguardando: 0, taxa_aguardando: 0, total_aguardando: 0, subtotal_pago: 0, taxa_pago: 0, total_pago: 0,
      ...minha,
    },
    ...extra,
  };
}

/** Mesa livre + cliente novo: sessão ainda não existe; abrir_sessao devolve SESSAO. */
function mesaLivre(rpcs: Record<string, unknown> = {}) {
  mockTabela('produtos', { select: PRODUTOS });
  mockRpc('sessao_atual', null);
  mockRpc('status_da_mesa', 'liberada');
  mockRpc('abrir_sessao', SESSAO);
  mockRpc('criar_pedido', null);
  for (const [nome, valor] of Object.entries(rpcs)) mockRpc(nome, valor as never);
}

async function entrar(nome = 'João') {
  await userEvent.click(await screen.findByRole('button', { name: 'Iniciar pedido' }));
  await screen.findByText('Caipirinha');
  await userEvent.type(await screen.findByLabelText('Seu nome ou apelido'), nome);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
}

// o nome também aparece no carrinho; o card é o que está numa seção do cardápio
const cardDe = (nome: string) => screen.getAllByText(nome).map((el) => el.closest('.card, .essencia-card')).find(Boolean) as HTMLElement;
const adicionar = (nome: string) => userEvent.click(within(cardDe(nome)).getByRole('button', { name: 'Adicionar' }));
const toast = () => document.querySelector('.toast') as HTMLElement;

describe('Cardápio — sessão da mesa via API (MSW)', () => {
  it('consulta sessao_atual com mesa+token do QR; sem sessão e liberada: boas-vindas; "Iniciar pedido" chama abrir_sessao', async () => {
    mesaLivre();
    renderPagina(<Cardapio />, URL_MESA);
    expect(await screen.findByText('Bem-vindo ao AOOBA! BAR')).toBeInTheDocument();
    expect(chamadasRpc('sessao_atual')[0].body).toEqual({ p_mesa: 5, p_token: 'TOKEN-MESA' });
    expect(chamadasRpc('status_da_mesa')[0].body).toEqual({ p_mesa: 5, p_token: 'TOKEN-MESA' });
    expect(chamadasRpc('abrir_sessao')).toHaveLength(0); // nunca automático
    expect(chamadasTabela('produtos')).toHaveLength(0); // cardápio só depois de entrar

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar pedido' }));
    await screen.findByText('Caipirinha');
    expect(chamadasRpc('abrir_sessao')[0].body).toEqual({ p_mesa: 5, p_token: 'TOKEN-MESA' });
  });

  it('produtos: só ativos, ordenados; agrupados por seção (drinks, cervejas, sem álcool, narguilé, essências)', async () => {
    mesaLivre();
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();

    const get = chamadasTabela('produtos', 'GET')[0];
    expect(get.query).toMatchObject({ ativo: 'eq.true', order: 'ordem.asc' });
    for (const nome of ['Caipirinha', 'Chopp', 'Suco', 'Narguilé Duplo', 'Menta']) expect(screen.getByText(nome)).toBeInTheDocument();
    expect(within(document.querySelector('#narguile') as HTMLElement).getByText('Narguilé Duplo')).toBeInTheDocument();
    expect(within(document.querySelector('#essencias') as HTMLElement).getByText('Menta')).toBeInTheDocument();
  });

  it('já existe conta aberta: pede confirmação e só "Entrar na conta" libera, sem chamar abrir_sessao', async () => {
    mockTabela('produtos', { select: PRODUTOS });
    mockRpc('sessao_atual', SESSAO);
    mockRpc('abrir_sessao', SESSAO);
    renderPagina(<Cardapio />, URL_MESA);
    expect(await screen.findByText(/já tem uma conta aberta/)).toBeInTheDocument();
    expect(chamadasTabela('produtos')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Entrar na conta' }));
    expect(await screen.findByText('Caipirinha')).toBeInTheDocument();
    expect(chamadasRpc('abrir_sessao')).toHaveLength(0);
    expect(sessionStorage.getItem('aooba_sessao_token')).toBe('tok-sessao-1');
  });

  it('mesa bloqueada: não abre sessão nem carrega o cardápio', async () => {
    mockTabela('produtos', { select: PRODUTOS });
    mockRpc('sessao_atual', null);
    mockRpc('status_da_mesa', 'bloqueada');
    renderPagina(<Cardapio />, URL_MESA);
    expect(await screen.findByText('Mesa aguardando liberação')).toBeInTheDocument();
    expect(chamadasRpc('abrir_sessao')).toHaveLength(0);
    expect(chamadasTabela('produtos')).toHaveLength(0);
  });

  it('erro MESA_BLOQUEADA ao iniciar (corrida) cai em "aguardando liberação"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mesaLivre();
    mockRpc('abrir_sessao', new ErroPg('mesa bloqueada', { details: 'MESA_BLOQUEADA' }));
    renderPagina(<Cardapio />, URL_MESA);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar pedido' }));
    expect(await screen.findByText('Mesa aguardando liberação')).toBeInTheDocument();
  });

  it('outro erro ao iniciar mostra a mensagem do servidor e mantém o botão', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mesaLivre();
    mockRpc('abrir_sessao', new ErroPg('Mesa desativada'));
    renderPagina(<Cardapio />, URL_MESA);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar pedido' }));
    await waitFor(() => expect(toast()).toHaveTextContent('Mesa desativada'));
    expect(screen.getByRole('button', { name: 'Iniciar pedido' })).toBeEnabled();
  });

  it('falha ao carregar o cardápio mostra erro e "Tentar novamente" recarrega', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let falhar = true;
    mesaLivre();
    mockTabela('produtos', { select: () => (falhar ? (new ErroPg('boom', { status: 500 }) as never) : PRODUTOS) });
    renderPagina(<Cardapio />, URL_MESA);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar pedido' }));

    const tentar = await screen.findByRole('button', { name: 'Tentar novamente' });
    falhar = false;
    await userEvent.click(tentar);
    expect(await screen.findByText('Caipirinha')).toBeInTheDocument();
  });
});

describe('Cardápio — pedido via API (MSW)', () => {
  it('criar_pedido leva mesa, token da mesa, itens, nome, cliente_id e token de SESSÃO', async () => {
    mesaLivre();
    renderPagina(<Cardapio />, URL_MESA);
    await entrar('João');
    await adicionar('Caipirinha');
    await adicionar('Caipirinha');
    await adicionar('Chopp');
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));

    await waitFor(() => expect(chamadasRpc('criar_pedido')).toHaveLength(1));
    expect(chamadasRpc('criar_pedido')[0].body).toEqual({
      p_mesa: 5,
      p_token: 'TOKEN-MESA',
      p_itens: [
        { produto_id: 1, quantidade: 2, compartilhado: false },
        { produto_id: 2, quantidade: 1, compartilhado: false },
      ],
      p_cliente_nome: 'João',
      p_cliente_id: sessionStorage.getItem('aooba_cliente_id'),
      p_token_sessao: 'tok-sessao-1',
    });
    expect(await screen.findByText('Pedido enviado! O garçom já foi avisado.')).toBeInTheDocument();
  });

  it('narguilé "Dividir entre a mesa" vai como compartilhado=true; essência entra com preço 0', async () => {
    mesaLivre();
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();

    await userEvent.click(within(cardDe('Narguilé Duplo')).getByLabelText('Dividir entre a mesa'));
    await adicionar('Narguilé Duplo');
    await adicionar('Menta');
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));

    await waitFor(() => expect(chamadasRpc('criar_pedido')).toHaveLength(1));
    expect((chamadasRpc('criar_pedido')[0].body as { p_itens: unknown[] }).p_itens).toEqual([
      { produto_id: 4, quantidade: 1, compartilhado: true },
      { produto_id: 5, quantidade: 1, compartilhado: false },
    ]);
  });

  it('o preço enviado nunca vem do cliente: o payload só tem produto_id, quantidade e compartilhado', async () => {
    mesaLivre();
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();
    await adicionar('Chopp');
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));
    await waitFor(() => expect(chamadasRpc('criar_pedido')).toHaveLength(1));
    const item = (chamadasRpc('criar_pedido')[0].body as { p_itens: Record<string, unknown>[] }).p_itens[0];
    expect(Object.keys(item).sort()).toEqual(['compartilhado', 'produto_id', 'quantidade']);
  });

  it('mensagem de erro do servidor (ex.: limite de pedidos) é mostrada e o carrinho é mantido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mesaLivre();
    mockRpc('criar_pedido', new ErroPg('Muitos pedidos em pouco tempo. Aguarde um instante.'));
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();
    await adicionar('Chopp');
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));

    await waitFor(() => expect(toast()).toHaveTextContent('Muitos pedidos em pouco tempo'));
    expect(document.querySelector('.cart-fab__badge')).toHaveTextContent('1');
  });

  it('SESSAO_ENCERRADA no pedido: "Conta encerrada" e a sessão guardada é apagada (F5 não libera)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mesaLivre();
    mockRpc('criar_pedido', new ErroPg('sessão encerrada', { details: 'SESSAO_ENCERRADA' }));
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();
    await adicionar('Chopp');
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));

    expect(await screen.findByText(/Foi um prazer ter você/)).toBeInTheDocument();
    expect(sessionStorage.getItem('aooba_sessao_token')).toBeNull();
    expect(JSON.parse(localStorage.getItem('aooba_encerrada')!)).toMatchObject({ mesa: '5', session_id: 'ses-1' });
  });

  it('MESA_BLOQUEADA no pedido leva a "aguardando liberação"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mesaLivre();
    mockRpc('criar_pedido', new ErroPg('mesa bloqueada', { details: 'MESA_BLOQUEADA' }));
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();
    await adicionar('Chopp');
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));
    expect(await screen.findByText('Mesa aguardando liberação')).toBeInTheDocument();
  });
});

describe('Cardápio — conta da mesa via API (MSW)', () => {
  async function abrirConta(conta: unknown = contaCliente()) {
    mesaLivre({ conta_da_mesa: conta });
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Conta' }));
    return (await screen.findByText(/^Conta —/)).closest('.modal-panel') as HTMLElement;
  }

  it('conta_da_mesa recebe mesa, token da mesa, cliente_id e token de sessão; mostra "Minha parte" e "Conta da mesa"', async () => {
    const modal = await abrirConta();
    await within(modal).findByText('Minha parte');

    expect(chamadasRpc('conta_da_mesa')[0].body).toEqual({
      p_mesa: 5, p_token: 'TOKEN-MESA', p_cliente_id: sessionStorage.getItem('aooba_cliente_id'), p_token_sessao: 'tok-sessao-1',
    });
    expect(within(modal).getByText('Narguilé Duplo (fração compartilhada)')).toBeInTheDocument();
    expect(within(modal).getByText('Conta da mesa')).toBeInTheDocument();
    expect(within(modal).getByText('Serviço (10%)')).toBeInTheDocument();
    expect(within(modal).getByText('Saldo restante').nextElementSibling!.textContent!.replace(/\s/g, ' ')).toBe('R$ 44,00');
    expect(within(modal).getByText('Em aberto')).toBeInTheDocument(); // status da pessoa
  });

  it('"Fechar minha parte" com taxa: confirma o valor e chama fechar_parcial com p_aceita_taxa=true', async () => {
    const confirma = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const modal = await abrirConta();
    mockRpc('fechar_parcial', { valor_total: 88 });
    await userEvent.click(await within(modal).findByRole('button', { name: 'Fechar minha parte' }));

    expect(confirma).toHaveBeenCalledWith(expect.stringMatching(/Fechar sua parte no valor de R\$\s88,00\?/));
    await waitFor(() => expect(chamadasRpc('fechar_parcial')).toHaveLength(1));
    expect(chamadasRpc('fechar_parcial')[0].body).toEqual({
      p_mesa: 5, p_token: 'TOKEN-MESA', p_cliente_id: sessionStorage.getItem('aooba_cliente_id'), p_aceita_taxa: true,
    });
    await waitFor(() => expect(toast()).toHaveTextContent(/Sua parte \(R\$\s88,00\) foi enviada ao balcão/));
    await waitFor(() => expect(chamadasRpc('conta_da_mesa').length).toBeGreaterThan(1)); // recarrega a conta
  });

  it('desmarcar a taxa recalcula o total na hora e envia p_aceita_taxa=false', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const modal = await abrirConta();
    mockRpc('fechar_parcial', { valor_total: 80 });
    const acao = (await within(modal).findByRole('button', { name: 'Fechar minha parte' })).closest('.conta-minha-acao') as HTMLElement;

    expect(within(acao).getByText('Serviço').nextElementSibling!.textContent!.replace(/\s/g, ' ')).toBe('R$ 8,00'); // 10% de 80
    await userEvent.click(within(acao).getByLabelText(/Incluir/));
    expect(within(acao).getByText('Serviço').nextElementSibling!.textContent!.replace(/\s/g, ' ')).toBe('R$ 0,00');
    expect(acao.querySelector('.conta-minha-total')!.textContent!.replace(/\s/g, ' ')).toBe('TotalR$ 80,00');

    await userEvent.click(within(acao).getByRole('button', { name: 'Fechar minha parte' }));
    await waitFor(() => expect(chamadasRpc('fechar_parcial')[0]?.body).toMatchObject({ p_aceita_taxa: false }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('(sem taxa de serviço)'));
  });

  it('cancelar a confirmação não chama fechar_parcial', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const modal = await abrirConta();
    mockRpc('fechar_parcial', { valor_total: 88 });
    await userEvent.click(await within(modal).findByRole('button', { name: 'Fechar minha parte' }));
    expect(chamadasRpc('fechar_parcial')).toHaveLength(0);
  });

  it('parte já enviada ao balcão ("aguardando") mostra o aviso e não oferece fechar de novo', async () => {
    const modal = await abrirConta(
      contaCliente({ status: 'aguardando', subtotal_aguardando: 80, taxa_aguardando: 8, total_aguardando: 88 }),
    );
    expect(await within(modal).findByText('Sua parte foi enviada ao balcão. Aguarde o garçom.')).toBeInTheDocument();
    expect(within(modal).queryByRole('button', { name: 'Fechar minha parte' })).not.toBeInTheDocument();
  });

  it('parte paga mostra "Você já pagou sua parte."', async () => {
    const modal = await abrirConta(contaCliente({ status: 'pago', subtotal_pago: 80, taxa_pago: 8, total_pago: 88 }));
    expect(await within(modal).findByText('Você já pagou sua parte.')).toBeInTheDocument();
    expect(within(modal).queryByRole('button', { name: 'Fechar minha parte' })).not.toBeInTheDocument();
  });

  it('quem ainda não pediu nada vê a mensagem e nenhuma ação de fechar', async () => {
    const modal = await abrirConta(contaCliente({ itens_diretos: [], itens_compartilhados: [], subtotal_em_aberto: 0 }));
    expect(await within(modal).findByText('Você ainda não pediu nada nessa mesa.')).toBeInTheDocument();
    expect(within(modal).queryByRole('button', { name: 'Fechar minha parte' })).not.toBeInTheDocument();
  });

  it('"Fechar a conta toda" chama pedir_fechamento com o token de sessão e avisa o garçom', async () => {
    const modal = await abrirConta();
    mockRpc('pedir_fechamento', null);
    await within(modal).findByText('Minha parte');
    await userEvent.click(within(modal).getByRole('button', { name: 'Fechar a conta toda' }));

    await waitFor(() => expect(chamadasRpc('pedir_fechamento')).toHaveLength(1));
    expect(chamadasRpc('pedir_fechamento')[0].body).toEqual({ p_mesa: 5, p_token: 'TOKEN-MESA', p_token_sessao: 'tok-sessao-1' });
    await waitFor(() => expect(toast()).toHaveTextContent('Pedido de fechamento enviado! O garçom já foi avisado.'));
    await waitFor(() => expect(screen.queryByText(/^Conta —/)).not.toBeInTheDocument()); // modal fechado
    expect(modal).not.toBeInTheDocument();
  });

  it('SESSAO_ENCERRADA ao consultar a conta fecha o modal e trava o cardápio', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mesaLivre({ conta_da_mesa: new ErroPg('encerrada', { details: 'SESSAO_ENCERRADA' }) });
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Conta' }));
    expect(await screen.findByText(/Foi um prazer ter você/)).toBeInTheDocument();
  });

  it('outro erro ao consultar a conta mostra a mensagem dentro do modal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mesaLivre({ conta_da_mesa: new ErroPg('Token inválido') });
    renderPagina(<Cardapio />, URL_MESA);
    await entrar();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Conta' }));
    expect(await screen.findByText('Token inválido')).toBeInTheDocument();
  });

  it('SESSAO_ENCERRADA ao pedir fechamento trava o cardápio', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const modal = await abrirConta();
    mockRpc('pedir_fechamento', new ErroPg('encerrada', { details: 'SESSAO_ENCERRADA' }));
    await within(modal).findByText('Minha parte');
    await userEvent.click(within(modal).getByRole('button', { name: 'Fechar a conta toda' }));
    expect(await screen.findByText(/Foi um prazer ter você/)).toBeInTheDocument();
  });
});
