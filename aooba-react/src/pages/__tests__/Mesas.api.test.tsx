import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Mesas from '../Mesas';
import GerarQrCodes from '../GerarQrCodes';
import { ErroPg, chamadasRpc, chamadasTabela, logadoComo, mockRpc, mockTabela } from '../../test/msw';
import { renderPagina } from '../../test/render';

const MESAS = [
  { numero: 1, token: 'tok1', ativa: true },
  { numero: 2, token: 'tok2', ativa: false },
];

const cardDaMesa = async (n: number) => (await screen.findByText(`Mesa ${n}`)).closest('.admin-mesa-card') as HTMLElement;

describe('Mesas — API (MSW)', () => {
  it('lista as mesas ordenadas por número, com o link do QR (?mesa=N&t=TOKEN)', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: MESAS });
    renderPagina(<Mesas />);

    const card = await cardDaMesa(1);
    expect(within(card).getByDisplayValue(`${window.location.origin}/?mesa=1&t=tok1`)).toBeInTheDocument();
    expect(within(await cardDaMesa(2)).getByText('Inativa')).toBeInTheDocument();

    const get = chamadasTabela('mesas', 'GET')[0];
    expect(get.query.select).toBe('numero,token,ativa');
    expect(get.query.order).toBe('numero.asc');
  });

  it('não consulta mesas antes do login', async () => {
    mockTabela('mesas', { select: MESAS });
    renderPagina(<Mesas />);
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(chamadasTabela('mesas')).toHaveLength(0);
  });

  it('adicionar mesa: POST { numero } e a lista é reordenada', async () => {
    logadoComo('admin');
    // a linha devolvida pelo servidor é a fonte da verdade
    mockTabela('mesas', { select: MESAS, insert: [{ numero: 5, token: 'tok5', ativa: true }] });
    renderPagina(<Mesas />);
    await cardDaMesa(1);

    await userEvent.type(screen.getByPlaceholderText('Nº da mesa'), '5');
    await userEvent.click(screen.getByRole('button', { name: '+ Adicionar mesa' }));

    await waitFor(() => expect(chamadasTabela('mesas', 'POST')).toHaveLength(1));
    expect(chamadasTabela('mesas', 'POST')[0].body).toEqual({ numero: 5 });
    expect(await cardDaMesa(5)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nº da mesa')).toHaveValue(null); // formulário limpo
  });

  it('mesa duplicada (23505) avisa "A mesa N já existe."', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    logadoComo('admin');
    mockTabela('mesas', { select: MESAS, insert: new ErroPg('duplicate key', { code: '23505', status: 409 }) as never });
    renderPagina(<Mesas />);
    await cardDaMesa(1);

    await userEvent.type(screen.getByPlaceholderText('Nº da mesa'), '1');
    await userEvent.click(screen.getByRole('button', { name: '+ Adicionar mesa' }));
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('A mesa 1 já existe.'));
  });

  it('ativar/desativar faz PATCH { ativa } filtrando por número', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: MESAS, update: [] });
    renderPagina(<Mesas />);

    await userEvent.click(within(await cardDaMesa(1)).getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(chamadasTabela('mesas', 'PATCH')).toHaveLength(1));
    expect(chamadasTabela('mesas', 'PATCH')[0]).toMatchObject({ query: { numero: 'eq.1' }, body: { ativa: false } });
    expect(await within(await cardDaMesa(1)).findByText('Mesa desativada.')).toBeInTheDocument();

    await userEvent.click(within(await cardDaMesa(2)).getByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(chamadasTabela('mesas', 'PATCH')).toHaveLength(2));
    expect(chamadasTabela('mesas', 'PATCH')[1]).toMatchObject({ query: { numero: 'eq.2' }, body: { ativa: true } });
  });

  it('regerar token pede confirmação; confirmado chama a RPC e atualiza o link', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: MESAS });
    mockRpc('regenerar_token_mesa', { numero: 1, token: 'NOVO', ativa: true });
    const confirma = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPagina(<Mesas />);

    const card = await cardDaMesa(1);
    await userEvent.click(within(card).getByRole('button', { name: 'Regerar token' }));
    expect(chamadasRpc('regenerar_token_mesa')).toHaveLength(0); // cancelou

    await userEvent.click(within(card).getByRole('button', { name: 'Regerar token' }));
    await waitFor(() => expect(chamadasRpc('regenerar_token_mesa')).toHaveLength(1));
    expect(chamadasRpc('regenerar_token_mesa')[0].body).toEqual({ p_numero: 1 });
    expect(confirma).toHaveBeenCalledTimes(2);
    expect(await within(await cardDaMesa(1)).findByDisplayValue(/t=NOVO/)).toBeInTheDocument();
    expect(await within(await cardDaMesa(1)).findByText(/Reimprima o QR code/)).toBeInTheDocument();
  });

  it('erro da RPC ao regerar token mantém o link antigo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logadoComo('admin');
    mockTabela('mesas', { select: MESAS });
    mockRpc('regenerar_token_mesa', new ErroPg('sem permissão', { status: 403 }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Mesas />);

    const card = await cardDaMesa(1);
    await userEvent.click(within(card).getByRole('button', { name: 'Regerar token' }));
    expect(await within(card).findByText(/Não foi possível gerar um novo link/)).toBeInTheDocument();
    expect(within(card).getByDisplayValue(/t=tok1/)).toBeInTheDocument();
  });

  it('copiar link usa a área de transferência', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: MESAS });
    const user = userEvent.setup();
    renderPagina(<Mesas />);

    await user.click(within(await cardDaMesa(1)).getByRole('button', { name: 'Copiar link' }));
    expect(await screen.findByText('Link copiado!')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/?mesa=1&t=tok1`);
  });

  it('sem mesas cadastradas mostra a mensagem vazia', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: [] });
    renderPagina(<Mesas />);
    expect(await screen.findByText(/Nenhuma mesa cadastrada ainda/)).toBeInTheDocument();
  });

  it('erro ao carregar mostra "Tentar novamente"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logadoComo('admin');
    mockTabela('mesas', { select: new ErroPg('boom', { status: 500 }) as never });
    renderPagina(<Mesas />);
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});

describe('Gerar QR codes — API (MSW)', () => {
  it('busca só mesas ativas ordenadas e renderiza um card por mesa', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: [{ numero: 1, token: 'tok1' }, { numero: 3, token: 'tok3' }] });
    renderPagina(<GerarQrCodes />);

    await waitFor(() => expect(document.querySelectorAll('.qr-card')).toHaveLength(2));
    const get = chamadasTabela('mesas', 'GET')[0];
    expect(get.query).toMatchObject({ ativa: 'eq.true', order: 'numero.asc', select: 'numero,token' });
    expect(screen.getAllByText('AOOBA! BAR')).toHaveLength(2);
  });

  it('sem mesas ativas mostra a orientação', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: [] });
    renderPagina(<GerarQrCodes />);
    expect(await screen.findByText(/Nenhuma mesa ativa cadastrada/)).toBeInTheDocument();
  });

  it('Recarregar consulta a API de novo', async () => {
    logadoComo('admin');
    mockTabela('mesas', { select: [{ numero: 1, token: 'tok1' }] });
    renderPagina(<GerarQrCodes />);
    await waitFor(() => expect(document.querySelectorAll('.qr-card')).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
    await waitFor(() => expect(chamadasTabela('mesas', 'GET')).toHaveLength(2));
  });

  it('erro de rede mostra mensagem e permite tentar de novo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logadoComo('admin');
    mockTabela('mesas', { select: new ErroPg('boom', { status: 500 }) as never });
    renderPagina(<GerarQrCodes />);
    expect(await screen.findByText(/Não foi possível carregar as mesas/)).toBeInTheDocument();
  });
});
