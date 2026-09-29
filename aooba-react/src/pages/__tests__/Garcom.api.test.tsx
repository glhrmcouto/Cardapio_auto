import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Garcom from '../Garcom';
import { ErroPg, chamadasRpc, chamadasTabela, logadoComo, mockRpc, mockTabela } from '../../test/msw';
import { renderPagina } from '../../test/render';

const MESAS = [
  { numero: 1, status_mesa: 'liberada', ativa: true },
  { numero: 2, status_mesa: 'bloqueada', ativa: true },
  { numero: 3, status_mesa: 'liberada', ativa: true },
  { numero: 4, status_mesa: 'bloqueada', ativa: false },
];
const SESSAO_MESA_3 = { id: 'ses-3', mesa: 3 };
const PRODUTOS = [
  { id: 1, nome: 'Caipirinha', preco: 20, categoria: 'drink' },
  { id: 2, nome: 'Chopp', preco: 12, categoria: 'cerveja' },
];
const PEDIDO = {
  id: 'ped-1', mesa: 3, total: 40, status: 'pendente', criado_em: '2026-03-01T22:15:00Z', cliente_nome: 'Ana',
  itens: [{ id: 11, nome: 'Caipirinha', preco: 20, quantidade: 2 }],
};
const CONTA = { itens: [{ nome: 'Caipirinha', preco: 20, quantidade: 2 }], total_geral: 44 };

function preparar(papel: 'garcom' | 'balcao' | 'admin' = 'garcom', extra: { pedidos?: unknown[]; sessoes?: unknown[] } = {}) {
  logadoComo(papel, 'garcom');
  mockTabela('sessoes', { select: extra.sessoes ?? [SESSAO_MESA_3] });
  mockTabela('pedidos', { select: extra.pedidos ?? [], update: [] });
  mockTabela('produtos', { select: PRODUTOS });
  mockRpc('listar_mesas_balcao', MESAS);
  mockRpc('conta_da_mesa_balcao', CONTA);
}

const cardMesa = async (n: number) => (await screen.findByText(`Mesa ${n}`, { selector: '.controle-mesa-card__mesa' })).closest('.controle-mesa-card') as HTMLElement;
const toast = () => document.querySelector('.toast') as HTMLElement;

describe('Garçom — acesso e mesas (MSW)', () => {
  it('papéis garcom, balcao e admin entram; outro papel (ou sem perfil) é barrado', async () => {
    for (const papel of ['garcom', 'balcao', 'admin'] as const) {
      preparar(papel);
      const { unmount } = renderPagina(<Garcom />);
      expect(await cardMesa(1)).toBeInTheDocument();
      unmount();
      localStorage.clear();
    }

    logadoComo(null, 'garcom'); // logado, mas sem linha em "perfis"
    renderPagina(<Garcom />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Este usuário não tem permissão de garçom/balcão/admin.');
  });

  it('usa a sessão própria do garçom (independente da de admin/balcão)', async () => {
    logadoComo('admin'); // só a sessão padrão: o garçom NÃO deve aproveitá-la
    mockTabela('sessoes', { select: [] });
    renderPagina(<Garcom />);
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
  });

  it('lista mesas com status; mesa inativa só oferece "Ativar mesa"; bloqueada oferece "Liberar mesa"', async () => {
    preparar();
    renderPagina(<Garcom />);

    expect(within(await cardMesa(1)).getByText('Liberada')).toBeInTheDocument();
    expect(within(await cardMesa(2)).getByText('Bloqueada')).toBeInTheDocument();
    expect(within(await cardMesa(2)).getByRole('button', { name: 'Liberar mesa' })).toBeInTheDocument();
    const inativa = await cardMesa(4);
    expect(within(inativa).getByRole('button', { name: 'Ativar mesa' })).toBeInTheDocument();
    expect(within(inativa).queryByRole('button', { name: 'Novo pedido' })).not.toBeInTheDocument();
    expect(within(await cardMesa(3)).getByText('Sessão aberta')).toBeInTheDocument();
    expect(chamadasTabela('sessoes', 'GET')[0].query.status).toBe('eq.aberta');
  });

  it('"Novo pedido" só aparece para o papel garcom; "Ver conta" só em mesa com sessão aberta', async () => {
    preparar('balcao');
    const { unmount } = renderPagina(<Garcom />);
    await cardMesa(1);
    expect(screen.queryByRole('button', { name: 'Novo pedido' })).not.toBeInTheDocument();
    expect(within(await cardMesa(3)).getByRole('button', { name: 'Ver conta' })).toBeInTheDocument(); // balcão vê conta
    unmount();
    localStorage.clear();

    preparar('garcom');
    renderPagina(<Garcom />);
    expect(within(await cardMesa(1)).getByRole('button', { name: 'Novo pedido' })).toBeInTheDocument();
    expect(within(await cardMesa(1)).queryByRole('button', { name: 'Ver conta' })).not.toBeInTheDocument();
  });

  it('liberar, desativar e ativar mesa chamam as RPCs com o número da mesa', async () => {
    preparar();
    mockRpc('liberar_mesa', null);
    mockRpc('desativar_mesa', null);
    mockRpc('ativar_mesa', null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Garcom />);

    await userEvent.click(within(await cardMesa(2)).getByRole('button', { name: 'Liberar mesa' }));
    await waitFor(() => expect(chamadasRpc('liberar_mesa')[0]?.body).toEqual({ p_mesa: 2 }));
    await waitFor(async () => expect(within(await cardMesa(2)).getByText('Liberada')).toBeInTheDocument());

    await userEvent.click(within(await cardMesa(1)).getByRole('button', { name: 'Desativar mesa' }));
    await waitFor(() => expect(chamadasRpc('desativar_mesa')[0]?.body).toEqual({ p_mesa: 1 }));

    await userEvent.click(within(await cardMesa(4)).getByRole('button', { name: 'Ativar mesa' }));
    await waitFor(() => expect(chamadasRpc('ativar_mesa')[0]?.body).toEqual({ p_mesa: 4 }));
  });

  it('"Liberar todas" / "Bloquear todas" usam as RPCs em massa', async () => {
    preparar();
    mockRpc('liberar_todas_mesas', 1);
    mockRpc('bloquear_todas_mesas', { bloqueadas: 3, puladas: 0 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Garcom />);
    await cardMesa(1);

    await userEvent.click(screen.getByRole('button', { name: 'Liberar todas' }));
    await waitFor(() => expect(toast()).toHaveTextContent('1 mesa liberada.'));

    await userEvent.click(screen.getByRole('button', { name: 'Bloquear todas' }));
    await waitFor(() => expect(chamadasRpc('bloquear_todas_mesas')[0]?.body).toEqual({ p_forcar: false }));
    await waitFor(() => expect(toast()).toHaveTextContent('3 mesas bloqueadas.'));
  });

  it('erro ao carregar mesas mostra "Tentar novamente"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    preparar();
    mockRpc('listar_mesas_balcao', new ErroPg('boom', { status: 500 }));
    renderPagina(<Garcom />);
    expect(await screen.findByText(/Não foi possível carregar as mesas/)).toBeInTheDocument();
  });
});

describe('Garçom — novo pedido sem QR (MSW)', () => {
  async function abrirNovoPedido(mesa: number) {
    await userEvent.click(within(await cardMesa(mesa)).getByRole('button', { name: 'Novo pedido' }));
    return (await screen.findByText(new RegExp(`Novo pedido — Mesa ${mesa}`))).closest('.modal-panel') as HTMLElement;
  }

  it('lança o pedido com itens e nome: RPC lancar_pedido_garcom (sem token de mesa)', async () => {
    preparar();
    mockRpc('lancar_pedido_garcom', null);
    renderPagina(<Garcom />);
    const modal = await abrirNovoPedido(1);

    expect(await within(modal).findByText('Caipirinha')).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Lançar pedido' })).toBeDisabled(); // carrinho vazio

    await userEvent.click(within(modal).getByRole('button', { name: 'Mais Caipirinha' }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Mais Caipirinha' }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Mais Chopp' }));
    expect(within(modal).getByText('R$ 52,00', { exact: false, selector: 'strong' })).toBeInTheDocument();
    await userEvent.type(within(modal).getByLabelText('Nome do cliente (opcional)'), 'Ana');
    await userEvent.click(within(modal).getByRole('button', { name: 'Lançar pedido' }));

    await waitFor(() => expect(chamadasRpc('lancar_pedido_garcom')).toHaveLength(1));
    expect(chamadasRpc('lancar_pedido_garcom')[0].body).toEqual({
      p_mesa: 1,
      p_itens: [{ produto_id: 1, quantidade: 2 }, { produto_id: 2, quantidade: 1 }],
      p_cliente_nome: 'Ana',
    });
    await waitFor(() => expect(toast()).toHaveTextContent('Pedido lançado!'));
    expect(chamadasTabela('produtos', 'GET')[0].query.ativo).toBe('eq.true');
  });

  it('sem nome envia p_cliente_nome null; quantidade zero não entra no pedido', async () => {
    preparar();
    mockRpc('lancar_pedido_garcom', null);
    renderPagina(<Garcom />);
    const modal = await abrirNovoPedido(1);
    await within(modal).findByText('Chopp');

    await userEvent.click(within(modal).getByRole('button', { name: 'Mais Chopp' }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Mais Caipirinha' }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Menos Caipirinha' })); // volta a zero
    await userEvent.click(within(modal).getByRole('button', { name: 'Lançar pedido' }));

    await waitFor(() => expect(chamadasRpc('lancar_pedido_garcom')).toHaveLength(1));
    expect(chamadasRpc('lancar_pedido_garcom')[0].body).toEqual({ p_mesa: 1, p_itens: [{ produto_id: 2, quantidade: 1 }], p_cliente_nome: null });
  });

  it('mesa bloqueada: confirma, libera a mesa (liberar_mesa) e só então abre o pedido', async () => {
    preparar();
    mockRpc('liberar_mesa', null);
    const confirma = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Garcom />);
    await userEvent.click(within(await cardMesa(2)).getByRole('button', { name: 'Novo pedido' }));

    await waitFor(() => expect(chamadasRpc('liberar_mesa')[0]?.body).toEqual({ p_mesa: 2 }));
    expect(confirma).toHaveBeenCalledWith(expect.stringContaining('Mesa 2 está bloqueada'));
    expect(await screen.findByText(/Novo pedido — Mesa 2/)).toBeInTheDocument();
  });

  it('mesa bloqueada e o garçom recusa liberar: nada acontece', async () => {
    preparar();
    mockRpc('liberar_mesa', null);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPagina(<Garcom />);
    await userEvent.click(within(await cardMesa(2)).getByRole('button', { name: 'Novo pedido' }));
    expect(chamadasRpc('liberar_mesa')).toHaveLength(0);
    expect(screen.getByText(/Novo pedido — Mesa/).closest('.modal-panel')).not.toHaveClass('is-open');
  });

  it('MESA_BLOQUEADA no envio explica o que fazer; o modal continua aberto', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    preparar();
    mockRpc('lancar_pedido_garcom', new ErroPg('mesa bloqueada', { details: 'MESA_BLOQUEADA' }));
    renderPagina(<Garcom />);
    const modal = await abrirNovoPedido(1);
    await userEvent.click(await within(modal).findByRole('button', { name: 'Mais Chopp' }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Lançar pedido' }));

    await waitFor(() => expect(alerta).toHaveBeenCalledWith(expect.stringContaining('bloqueada de novo')));
    expect(modal).toHaveClass('is-open');
  });

  it('erro genérico mostra a mensagem do servidor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    preparar();
    mockRpc('lancar_pedido_garcom', new ErroPg('Produto indisponível'));
    renderPagina(<Garcom />);
    const modal = await abrirNovoPedido(1);
    await userEvent.click(await within(modal).findByRole('button', { name: 'Mais Chopp' }));
    await userEvent.click(within(modal).getByRole('button', { name: 'Lançar pedido' }));
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('Produto indisponível'));
  });
});

describe('Garçom — conta da mesa e pedidos (MSW)', () => {
  it('"Ver conta" carrega conta_da_mesa_balcao e mostra itens e total', async () => {
    preparar('balcao');
    renderPagina(<Garcom />);
    await userEvent.click(within(await cardMesa(3)).getByRole('button', { name: 'Ver conta' }));

    const modal = (await screen.findByText(/Conta — Mesa 3/)).closest('.modal-panel') as HTMLElement;
    expect(await within(modal).findByText('2x Caipirinha')).toBeInTheDocument();
    expect(within(modal).getByText('R$ 44,00', { exact: false, selector: 'strong' })).toBeInTheDocument();
    expect(chamadasRpc('conta_da_mesa_balcao')[0].body).toEqual({ p_mesa: 3 });
  });

  it('"Fechar conta" confirma e encerra a sessão; a mesa fica bloqueada e some "Ver conta"', async () => {
    preparar('balcao');
    mockRpc('encerrar_sessao', null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Garcom />);
    await userEvent.click(within(await cardMesa(3)).getByRole('button', { name: 'Ver conta' }));
    const modal = (await screen.findByText(/Conta — Mesa 3/)).closest('.modal-panel') as HTMLElement;
    await within(modal).findByText('2x Caipirinha');
    await userEvent.click(within(modal).getByRole('button', { name: 'Fechar conta' }));

    await waitFor(() => expect(chamadasRpc('encerrar_sessao')[0]?.body).toEqual({ p_mesa: 3, p_forcar: false }));
    await waitFor(() => expect(toast()).toHaveTextContent('Conta da Mesa 3 fechada.'));
    expect(within(await cardMesa(3)).getByText('Bloqueada')).toBeInTheDocument();
    expect(within(await cardMesa(3)).queryByRole('button', { name: 'Ver conta' })).not.toBeInTheDocument();
  });

  it('fechar conta com saldo pendente pergunta e força só se confirmar', async () => {
    preparar('balcao');
    mockRpc('encerrar_sessao', ({ body }) => ((body as { p_forcar: boolean }).p_forcar ? null : new ErroPg('Ainda falta receber R$ 20,00 de Ana.')));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Garcom />);
    await userEvent.click(within(await cardMesa(3)).getByRole('button', { name: 'Ver conta' }));
    const modal = (await screen.findByText(/Conta — Mesa 3/)).closest('.modal-panel') as HTMLElement;
    await within(modal).findByText('2x Caipirinha');
    await userEvent.click(within(modal).getByRole('button', { name: 'Fechar conta' }));

    await waitFor(() => expect(chamadasRpc('encerrar_sessao')).toHaveLength(2));
    expect(chamadasRpc('encerrar_sessao').map((c) => (c.body as { p_forcar: boolean }).p_forcar)).toEqual([false, true]);
  });

  it('aba Pedidos lista os pendentes com badge e "Entregue" faz PATCH no pedido', async () => {
    preparar('garcom', { pedidos: [PEDIDO] });
    renderPagina(<Garcom />);
    await cardMesa(1);

    await userEvent.click(screen.getByRole('button', { name: /Pedidos/ }));
    const card = (await screen.findByText('Ana')).closest('.pedido-card') as HTMLElement;
    expect(within(card).getByText('2x Caipirinha')).toBeInTheDocument();
    expect(document.querySelector('.garcom-tabbar__badge')).toHaveTextContent('1');
    expect(chamadasTabela('pedidos', 'GET')[0].query).toMatchObject({ tipo: 'eq.pedido', status: 'eq.pendente' });

    await userEvent.click(within(card).getByRole('button', { name: 'Entregue' }));
    await waitFor(() => expect(screen.queryByText('Ana')).not.toBeInTheDocument());
    expect(chamadasTabela('pedidos', 'PATCH')[0]).toMatchObject({ query: { id: 'eq.ped-1' }, body: { status: 'entregue' } });
  });

  it('sem pedidos pendentes mostra a mensagem de vazio', async () => {
    preparar();
    renderPagina(<Garcom />);
    await cardMesa(1);
    await userEvent.click(screen.getByRole('button', { name: /Pedidos/ }));
    expect(await screen.findByText('Nenhum pedido pendente no momento.')).toBeInTheDocument();
  });
});
