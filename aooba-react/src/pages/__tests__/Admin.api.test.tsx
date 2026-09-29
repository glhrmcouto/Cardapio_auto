import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Admin from '../Admin';
import { ErroPg, chamadasTabela, logadoComo, mockLogin, mockTabela } from '../../test/msw';
import { renderPagina } from '../../test/render';

const PRODUTOS = [
  { id: 1, nome: 'Caipirinha', descricao: 'Limão', preco: 20, categoria: 'drink', ativo: true, ordem: 1 },
  { id: 2, nome: 'Mojito', descricao: 'Hortelã', preco: 25, categoria: 'drink', ativo: true, ordem: 2 },
  { id: 3, nome: 'Chopp', descricao: 'Gelado', preco: 12, categoria: 'cerveja', ativo: false, ordem: 1 },
];

function preparar(extra: Parameters<typeof mockTabela>[1] = {}) {
  logadoComo('admin');
  mockTabela('produtos', { select: PRODUTOS, ...extra });
  mockTabela('configuracoes', { select: [{ valor: '10' }], update: [{}] });
}

const botaoSalvarTaxa = () => within(document.querySelector('form.admin-config-card') as HTMLElement).getByRole('button', { name: 'Salvar' });
const cardDe = async (nome: string) => (await screen.findByDisplayValue(nome)).closest('.admin-produto-card') as HTMLElement;

describe('Admin — API de produtos e taxa (MSW)', () => {
  it('carrega produtos ordenados por categoria/ordem e agrupa por categoria', async () => {
    preparar();
    renderPagina(<Admin />);

    expect(await screen.findByRole('heading', { name: 'Drinks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cervejas' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mojito')).toBeInTheDocument();

    const get = chamadasTabela('produtos', 'GET')[0];
    expect(get.query.order).toBe('categoria.asc,ordem.asc');
  });

  it('salvar edita só aquele produto (PATCH ?id=eq.N) com os campos do formulário', async () => {
    preparar();
    renderPagina(<Admin />);
    const card = await cardDe('Caipirinha');

    const nome = within(card).getByDisplayValue('Caipirinha');
    await userEvent.clear(nome);
    await userEvent.type(nome, 'Caipirinha Premium');
    await userEvent.click(within(card).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(chamadasTabela('produtos', 'PATCH')).toHaveLength(1));
    const patch = chamadasTabela('produtos', 'PATCH')[0];
    expect(patch.query.id).toBe('eq.1');
    expect(patch.body).toEqual({ nome: 'Caipirinha Premium', descricao: 'Limão', preco: 20, categoria: 'drink', ordem: 1 });
    expect(await within(card).findByText('Salvo com sucesso!')).toBeInTheDocument();
  });

  it('nome vazio não chama a API e mostra erro', async () => {
    preparar();
    renderPagina(<Admin />);
    const card = await cardDe('Caipirinha');
    await userEvent.clear(within(card).getByDisplayValue('Caipirinha'));
    await userEvent.click(within(card).getByRole('button', { name: 'Salvar' }));

    expect(await within(card).findByText('O nome não pode ficar vazio.')).toBeInTheDocument();
    expect(chamadasTabela('produtos', 'PATCH')).toHaveLength(0);
  });

  it('preço é digitado com máscara de moeda e enviado como número', async () => {
    preparar();
    renderPagina(<Admin />);
    const card = await cardDe('Mojito');
    const preco = within(card).getAllByRole('textbox').find((el) => (el as HTMLInputElement).value.includes('R$'))!;
    await userEvent.clear(preco);
    await userEvent.type(preco, '3050');
    expect((preco as HTMLInputElement).value.replace(/\s/g, ' ')).toBe('R$ 30,50');

    await userEvent.click(within(card).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(chamadasTabela('produtos', 'PATCH')).toHaveLength(1));
    expect(chamadasTabela('produtos', 'PATCH')[0].body).toMatchObject({ preco: 30.5 });
  });

  it('falha de rede/servidor ao salvar mostra erro e mantém o formulário', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    preparar({ update: new ErroPg('falhou', { status: 500 }) as never });
    renderPagina(<Admin />);
    const card = await cardDe('Caipirinha');
    await userEvent.click(within(card).getByRole('button', { name: 'Salvar' }));
    expect(await within(card).findByText(/Não foi possível salvar/)).toBeInTheDocument();
  });

  it('desativar manda { ativo: false }; ativar manda { ativo: true }', async () => {
    preparar();
    renderPagina(<Admin />);
    const ativo = await cardDe('Caipirinha');
    await userEvent.click(within(ativo).getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(chamadasTabela('produtos', 'PATCH')).toHaveLength(1));
    expect(chamadasTabela('produtos', 'PATCH')[0]).toMatchObject({ query: { id: 'eq.1' }, body: { ativo: false } });

    const inativo = await cardDe('Chopp');
    await userEvent.click(within(inativo).getByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(chamadasTabela('produtos', 'PATCH')).toHaveLength(2));
    expect(chamadasTabela('produtos', 'PATCH')[1]).toMatchObject({ query: { id: 'eq.3' }, body: { ativo: true } });
  });

  it('excluir pede confirmação; cancelar não chama a API', async () => {
    preparar();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPagina(<Admin />);
    const card = await cardDe('Mojito');
    await userEvent.click(within(card).getByRole('button', { name: 'Excluir' }));
    expect(chamadasTabela('produtos', 'DELETE')).toHaveLength(0);
    expect(screen.getByDisplayValue('Mojito')).toBeInTheDocument();
  });

  it('excluir confirmado faz DELETE e remove o card', async () => {
    preparar({ delete: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Admin />);
    const card = await cardDe('Mojito');
    await userEvent.click(within(card).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(screen.queryByDisplayValue('Mojito')).not.toBeInTheDocument());
    expect(chamadasTabela('produtos', 'DELETE')[0].query.id).toBe('eq.2');
  });

  it('excluir produto já pedido (FK 23503) recusa e sugere desativar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    preparar({ delete: new ErroPg('violates foreign key', { code: '23503', status: 409 }) as never });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Admin />);
    const card = await cardDe('Mojito');
    await userEvent.click(within(card).getByRole('button', { name: 'Excluir' }));

    expect(await within(card).findByText(/já foi pedido alguma vez/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mojito')).toBeInTheDocument();
  });

  it('criar produto: POST com ativo=true e ordem sugerida (última da categoria + 1)', async () => {
    const criado = { id: 9, nome: 'Gin Tônica', descricao: 'Gelado', preco: 30, categoria: 'drink', ativo: true, ordem: 3 };
    preparar({ insert: [criado] });
    renderPagina(<Admin />);
    await screen.findByDisplayValue('Caipirinha');

    await userEvent.click(screen.getByRole('button', { name: '+ Adicionar produto' }));
    const rascunho = document.querySelector('.admin-produto-card--novo') as HTMLElement;
    expect(within(rascunho).getByDisplayValue('3')).toBeInTheDocument(); // ordem sugerida

    await userEvent.type(within(rascunho).getByPlaceholderText('Ex: Caipirinha'), 'Gin Tônica');
    await userEvent.type(within(rascunho).getByPlaceholderText('Descrição curta do item'), 'Gelado');
    const preco = within(rascunho).getAllByRole('textbox').find((el) => (el as HTMLInputElement).value.includes('R$'))!;
    await userEvent.clear(preco);
    await userEvent.type(preco, '3000');
    await userEvent.click(within(rascunho).getByRole('button', { name: 'Criar produto' }));

    await waitFor(() => expect(chamadasTabela('produtos', 'POST')).toHaveLength(1));
    expect(chamadasTabela('produtos', 'POST')[0].body).toEqual({ nome: 'Gin Tônica', descricao: 'Gelado', preco: 30, categoria: 'drink', ordem: 3, ativo: true });
    expect(await screen.findByDisplayValue('Gin Tônica')).toBeInTheDocument();
    expect(document.querySelector('.admin-produto-card--novo')).toBeNull();
  });

  it('mover para cima troca a ordem dos dois produtos (2 PATCH)', async () => {
    preparar();
    renderPagina(<Admin />);
    const card = await cardDe('Mojito');
    await userEvent.click(within(card).getByRole('button', { name: 'Mover pra cima na categoria' }));

    await waitFor(() => expect(chamadasTabela('produtos', 'PATCH')).toHaveLength(2));
    const porId = Object.fromEntries(chamadasTabela('produtos', 'PATCH').map((c) => [c.query.id, c.body]));
    expect(porId['eq.2']).toEqual({ ordem: 1 });
    expect(porId['eq.1']).toEqual({ ordem: 2 });
  });

  it('taxa de serviço: carrega o valor atual e salva o novo percentual', async () => {
    preparar();
    renderPagina(<Admin />);
    const campo = await screen.findByLabelText('Taxa de serviço (%)');
    expect(campo).toHaveValue(10);
    expect(chamadasTabela('configuracoes', 'GET')[0].query.chave).toBe('eq.taxa_servico_percentual');

    await userEvent.clear(campo);
    await userEvent.type(campo, '12.5');
    await userEvent.click(botaoSalvarTaxa());

    await waitFor(() => expect(chamadasTabela('configuracoes', 'PATCH')).toHaveLength(1));
    expect(chamadasTabela('configuracoes', 'PATCH')[0]).toMatchObject({ query: { chave: 'eq.taxa_servico_percentual' }, body: { valor: '12.5' } });
    expect(await screen.findByText('Salvo com sucesso!')).toBeInTheDocument();
  });

  it('taxa 0 desativa a cobrança e avisa; taxa > 100 é barrada sem chamar a API', async () => {
    preparar();
    renderPagina(<Admin />);
    const campo = await screen.findByLabelText('Taxa de serviço (%)');

    await userEvent.clear(campo);
    await userEvent.type(campo, '150');
    await userEvent.click(botaoSalvarTaxa());
    // max=100: o navegador já barra o envio (validação nativa), então a API não é chamada.
    expect(chamadasTabela('configuracoes', 'PATCH')).toHaveLength(0);

    await userEvent.clear(campo);
    await userEvent.type(campo, '0');
    await userEvent.click(botaoSalvarTaxa());
    expect(await screen.findByText('Salvo! Taxa de serviço desativada.')).toBeInTheDocument();
  });

  it('erro ao carregar produtos mostra "Tentar novamente" e recarrega', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logadoComo('admin');
    let falhar = true;
    mockTabela('produtos', { select: () => (falhar ? (new ErroPg('boom', { status: 500 }) as never) : PRODUTOS) });
    mockTabela('configuracoes', { select: [{ valor: '10' }] });
    renderPagina(<Admin />);

    const botoes = await screen.findAllByRole('button', { name: 'Tentar novamente' });
    falhar = false;
    await userEvent.click(botoes[0]);
    expect(await screen.findByDisplayValue('Caipirinha')).toBeInTheDocument();
  });
});

describe('Admin — acesso (MSW)', () => {
  it('sem sessão mostra o login e não consulta produtos', async () => {
    mockTabela('produtos', { select: PRODUTOS });
    renderPagina(<Admin />);
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(chamadasTabela('produtos')).toHaveLength(0);
  });

  it('usuário logado como balcão é barrado (perfis.papel != admin)', async () => {
    logadoComo('balcao');
    mockTabela('produtos', { select: PRODUTOS });
    renderPagina(<Admin />);
    expect(await screen.findByRole('alert')).toHaveTextContent('não tem permissão de administrador');
    expect(chamadasTabela('produtos')).toHaveLength(0);
  });

  it('login com senha errada mostra erro; com senha certa e papel admin entra e carrega o cardápio', async () => {
    mockTabela('produtos', { select: PRODUTOS });
    mockTabela('configuracoes', { select: [{ valor: '10' }] });

    mockLogin(false);
    const { unmount } = renderPagina(<Admin />);
    await userEvent.type(await screen.findByLabelText('E-mail'), 'dono@aooba.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
    unmount();

    mockLogin(true, 'admin');
    renderPagina(<Admin />);
    await userEvent.type(await screen.findByLabelText('E-mail'), 'dono@aooba.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'certa');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByDisplayValue('Caipirinha')).toBeInTheDocument();
    expect(chamadasTabela('auth/token').at(-1)?.body).toMatchObject({ email: 'dono@aooba.com', password: 'certa' });
  });
});
