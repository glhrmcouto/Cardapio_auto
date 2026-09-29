import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { criarSupabaseFalso, type OpcoesMock, type SupabaseFalso } from '../../../test/supabaseMock';
import { ToastProvider } from '../../../components/Toast';

let falso: SupabaseFalso;
vi.mock('../../../lib/supabase', () => ({
  get supabase() {
    return falso;
  },
}));

// Importa depois do mock (vi.mock é içado, mas deixamos explícito).
import Cardapio from '../../Cardapio';

const PRODUTOS = [
  { id: 1, nome: 'Caipirinha', descricao: 'Limão e cachaça', preco: 20, categoria: 'drink' },
  { id: 2, nome: 'Chopp', descricao: 'Gelado', preco: 12, categoria: 'cerveja' },
];

function montar(url: string, opcoes: OpcoesMock = {}) {
  falso = criarSupabaseFalso({ ...opcoes, tabelas: { produtos: { data: PRODUTOS }, ...opcoes.tabelas } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Cardapio />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const URL_MESA = '/?mesa=5&t=TOKEN';
const SESSAO = { sessao_id: 's1', token_sessao: 'ts1' };

async function entrarNaMesaLivre() {
  await userEvent.click(await screen.findByRole('button', { name: 'Iniciar pedido' }));
  await screen.findByText('Caipirinha');
}

async function informarNome(nome = 'João') {
  await userEvent.type(await screen.findByLabelText('Seu nome ou apelido'), nome);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
}

describe('Cardápio — acesso e sessão da mesa', () => {
  it('sem mesa+token na URL: acesso bloqueado, sem botão e sem consultar sessão', async () => {
    montar('/?mesa=5');
    expect(await screen.findByText(/escaneie o QR code da mesa novamente/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar pedido' })).not.toBeInTheDocument();
    expect(falso.rpc).not.toHaveBeenCalled();
    expect(screen.queryByText('Caipirinha')).not.toBeInTheDocument();
  });

  it('mesa livre e cliente novo: boas-vindas; só o toque abre a sessão e libera o cardápio', async () => {
    montar(URL_MESA, {
      rpc: { sessao_atual: { data: null }, status_da_mesa: { data: 'liberada' }, abrir_sessao: { data: SESSAO } },
    });
    expect(await screen.findByText('Bem-vindo ao AOOBA! BAR')).toBeInTheDocument();
    expect(falso.rpc).not.toHaveBeenCalledWith('abrir_sessao', expect.anything());
    expect(screen.queryByText('Caipirinha')).not.toBeInTheDocument(); // cardápio não carrega antes

    await entrarNaMesaLivre();
    expect(falso.rpc).toHaveBeenCalledWith('abrir_sessao', { p_mesa: 5, p_token: 'TOKEN' });
    expect(sessionStorage.getItem('aooba_sessao_token')).toBe('ts1');
  });

  it('mesa bloqueada: "Mesa aguardando liberação", sem botão', async () => {
    montar(URL_MESA, { rpc: { sessao_atual: { data: null }, status_da_mesa: { data: 'bloqueada' } } });
    expect(await screen.findByText('Mesa aguardando liberação')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar pedido' })).not.toBeInTheDocument();
  });

  it('já existe sessão aberta e este aparelho não a tinha: pede confirmação; "Entrar" libera', async () => {
    montar(URL_MESA, { rpc: { sessao_atual: { data: SESSAO } } });
    expect(await screen.findByText(/já tem uma conta aberta/i)).toBeInTheDocument();
    expect(screen.queryByText('Caipirinha')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Entrar na conta' }));
    expect(await screen.findByText('Caipirinha')).toBeInTheDocument();
  });

  it('cancelar a entrada mantém tudo travado', async () => {
    montar(URL_MESA, { rpc: { sessao_atual: { data: SESSAO } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText(/Tudo bem\. Se quiser pedir na Mesa 5/)).toBeInTheDocument();
    expect(screen.queryByText('Caipirinha')).not.toBeInTheDocument();
  });

  it('sessão guardada nesta aba e ainda aberta: entra direto, sem reperguntar', async () => {
    sessionStorage.setItem('aooba_sessao_id', 's1');
    sessionStorage.setItem('aooba_sessao_token', 'ts1');
    sessionStorage.setItem('aooba_sessao_mesa', '5');
    montar(URL_MESA, { rpc: { sessao_atual: { data: SESSAO } } });
    expect(await screen.findByText('Caipirinha')).toBeInTheDocument();
    expect(screen.queryByText(/já tem uma conta aberta/i)).not.toBeInTheDocument();
  });

  it('havia sessão guardada mas o servidor diz que fechou: "Conta encerrada" (nunca boas-vindas)', async () => {
    sessionStorage.setItem('aooba_sessao_id', 's-velha');
    sessionStorage.setItem('aooba_sessao_token', 'ts-velho');
    sessionStorage.setItem('aooba_sessao_mesa', '5');
    montar(URL_MESA, { rpc: { sessao_atual: { data: null }, status_da_mesa: { data: 'liberada' } } });
    expect(await screen.findByText(/Foi um prazer ter você/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar pedido' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('aooba_encerrada')!).session_id).toBe('s-velha');
  });

  it('marca de conta encerrada no localStorage (aba nova) também bloqueia as boas-vindas', async () => {
    localStorage.setItem('aooba_encerrada', JSON.stringify({ mesa: '5', session_id: 's-x', encerrada_em: '2026-01-01' }));
    montar(URL_MESA, { rpc: { sessao_atual: { data: null }, status_da_mesa: { data: 'liberada' } } });
    expect(await screen.findByText(/Foi um prazer ter você/)).toBeInTheDocument();
  });

  it('erro ao consultar a sessão trava em vez de liberar o cardápio', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    montar(URL_MESA, { rpc: { sessao_atual: { error: { message: 'rede' } }, status_da_mesa: { data: 'liberada' } } });
    expect(await screen.findByText('Bem-vindo ao AOOBA! BAR')).toBeInTheDocument();
    expect(screen.queryByText('Caipirinha')).not.toBeInTheDocument();
  });
});

describe('Cardápio — nome, carrinho e pedido', () => {
  const opcoesLivre: OpcoesMock = {
    rpc: { sessao_atual: { data: null }, status_da_mesa: { data: 'liberada' }, abrir_sessao: { data: SESSAO }, criar_pedido: { data: null } },
  };

  it('depois de entrar pede o nome; sem nome não fecha o modal', async () => {
    montar(URL_MESA, opcoesLivre);
    await entrarNaMesaLivre();
    expect(await screen.findByText('Como podemos te chamar?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(screen.getByText('Digite um nome pra continuar.')).toHaveClass('show');
  });

  it('adicionar abre o carrinho, soma o total e badge; fazer pedido envia criar_pedido com token de sessão', async () => {
    montar(URL_MESA, opcoesLivre);
    await entrarNaMesaLivre();
    await informarNome('João');

    const card = screen.getByText('Caipirinha').closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Adicionar' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Adicionar' }));

    const painel = document.querySelector('.cart-panel') as HTMLElement;
    expect(painel).toHaveClass('is-open');
    expect(within(painel).getByText(/40,00/)).toBeInTheDocument();
    expect(document.querySelector('.cart-fab__badge')).toHaveTextContent('2');

    await userEvent.click(within(painel).getByRole('button', { name: 'Fazer Pedido' }));

    await waitFor(() =>
      expect(falso.rpc).toHaveBeenCalledWith('criar_pedido', {
        p_mesa: 5,
        p_token: 'TOKEN',
        p_itens: [{ produto_id: 1, quantidade: 2, compartilhado: false }],
        p_cliente_nome: 'João',
        p_cliente_id: expect.any(String),
        p_token_sessao: 'ts1',
      }),
    );
    expect(await screen.findByText('Pedido enviado! O garçom já foi avisado.')).toBeInTheDocument();
    expect(document.querySelector('.cart-fab__badge')).toHaveTextContent('0'); // carrinho limpo
  });

  it('fazer pedido com carrinho vazio avisa e não chama a RPC', async () => {
    montar(URL_MESA, opcoesLivre);
    await entrarNaMesaLivre();
    await informarNome();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir carrinho' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));
    expect(await screen.findByText('Adicione pelo menos um item antes de fazer o pedido.')).toBeInTheDocument();
    expect(falso.rpc).not.toHaveBeenCalledWith('criar_pedido', expect.anything());
  });

  it('erro genérico do servidor mantém o carrinho e mostra a mensagem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    montar(URL_MESA, { rpc: { ...opcoesLivre.rpc, criar_pedido: { error: { message: 'Mesa indisponível', details: null } } } });
    await entrarNaMesaLivre();
    await informarNome();
    const card = screen.getByText('Chopp').closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Adicionar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));

    expect(await screen.findByText('Mesa indisponível')).toBeInTheDocument();
    expect(document.querySelector('.cart-fab__badge')).toHaveTextContent('1');
  });

  it('SESSAO_ENCERRADA no envio: trava em "Conta encerrada" e mantém o carrinho', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    montar(URL_MESA, { rpc: { ...opcoesLivre.rpc, criar_pedido: { error: { message: 'x', details: 'SESSAO_ENCERRADA' } } } });
    await entrarNaMesaLivre();
    await informarNome();
    const card = screen.getByText('Chopp').closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'Adicionar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fazer Pedido' }));

    expect(await screen.findByText(/Foi um prazer ter você/)).toBeInTheDocument();
    expect(sessionStorage.getItem('aooba_sessao_token')).toBeNull();
  });

  it('sem número de mesa preenchido, "Fechar Conta" avisa em vez de abrir o modal', async () => {
    montar('/'); // sem mesa: acesso bloqueado, mas o campo existe
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Conta' }));
    expect(screen.getByText('Preencha o número da mesa antes de pedir!')).toHaveClass('show');
  });

  it('mesa vinda do QR fica travada (somente leitura)', async () => {
    montar(URL_MESA, opcoesLivre);
    const campo = screen.getByLabelText('Número da mesa:') as HTMLInputElement;
    expect(campo.value).toBe('5');
    expect(campo).toHaveAttribute('readonly');
  });
});
