import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import Balcao from '../Balcao';
import { BASE, ErroPg, chamadasRpc, chamadasTabela, logadoComo, mockRpc, mockTabela, server } from '../../test/msw';
import { renderPagina } from '../../test/render';

const PEDIDO = {
  id: 'ped-1',
  mesa: 3,
  total: 45,
  status: 'pendente',
  criado_em: '2026-03-01T22:15:00Z',
  cliente_nome: 'Ana',
  itens: [
    { id: 11, nome: 'Caipirinha', preco: 20, quantidade: 2 },
    { id: 12, nome: 'Água', preco: 5, quantidade: 1 },
  ],
};
const FECHAMENTO = { id: 'fech-1', mesa: 3, criado_em: '2026-03-01T22:30:00Z' };
const PAGAMENTO = {
  id: 'pag-1', sessao_id: 'ses-1', cliente_id: 'cli-1', nome: 'Bia', subtotal: 20, taxa_servico: 2, valor_total: 22,
  taxa_aceita: false, status: 'pendente', criado_em: '2026-03-01T22:40:00Z', sessoes: { mesa: 3 },
};
const SESSAO = { id: 'ses-1', mesa: 3, aberta_em: '2026-03-01T21:00:00Z' };
const MESAS = [
  { numero: 1, status_mesa: 'liberada', ativa: true },
  { numero: 2, status_mesa: 'bloqueada', ativa: true },
  { numero: 3, status_mesa: 'liberada', ativa: true },
  { numero: 4, status_mesa: 'bloqueada', ativa: false },
];
const CONTA = {
  itens: [{ nome: 'Caipirinha', preco: 20, quantidade: 2 }],
  subtotal: 40, taxa_servico: 4, total_geral: 44, total_pago: 10, total_pendente_confirmacao: 0, saldo_restante: 34, por_pessoa: [],
};

interface Cenario {
  pedidos?: unknown[];
  fechamentos?: unknown[];
  pagamentos?: unknown[];
  sessoes?: unknown[];
  historico?: unknown[];
  conta?: unknown;
}

function preparar(c: Cenario = {}) {
  logadoComo('balcao');
  mockTabela('pedidos', {
    select: ({ query }) => {
      if (query.tipo === 'eq.fechar_conta') return c.fechamentos ?? [];
      if (query.status === 'eq.pendente') return c.pedidos ?? [];
      return c.historico ?? []; // histórico: sem filtro de status
    },
    update: [],
  });
  mockTabela('pagamentos', { select: c.pagamentos ?? [] });
  mockTabela('sessoes', { select: c.sessoes ?? [] });
  mockRpc('listar_mesas_balcao', MESAS);
  mockRpc('conta_da_mesa_balcao', c.conta ?? CONTA);
  mockRpc('detalhe_pagamento', {
    itens_diretos: [{ nome: 'Chopp', preco: 10, quantidade: 2 }],
    itens_compartilhados: [{ nome: 'Narguilé', valor: 5 }],
  });
}

const toast = () => document.querySelector('.toast') as HTMLElement;

/** Faz a próxima reautenticação por senha (modal de confirmação) falhar. */
function senhaIncorreta() {
  server.use(http.post(`${BASE}/auth/v1/token`, () => HttpResponse.json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, { status: 400 })));
}

async function digitarSenha(senha: string) {
  await userEvent.type(await screen.findByLabelText('Senha'), senha);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
}

describe('Balcão — carga inicial (MSW)', () => {
  it('busca pedidos pendentes (com itens), fechamentos, pagamentos, sessões abertas e mesas', async () => {
    preparar({ pedidos: [PEDIDO], sessoes: [SESSAO] });
    renderPagina(<Balcao />);
    await screen.findByText('Ana');

    const [ped] = chamadasTabela('pedidos', 'GET').filter((c) => c.query.tipo === 'eq.pedido' && c.query.status === 'eq.pendente');
    expect(ped.query.order).toBe('criado_em.asc');
    expect(ped.query.select).toContain('itens:pedido_itens(');
    expect(chamadasTabela('pedidos', 'GET').some((c) => c.query.tipo === 'eq.fechar_conta' && c.query.status === 'eq.pendente')).toBe(true);
    expect(chamadasTabela('pagamentos', 'GET')[0].query.status).toBe('eq.pendente');
    expect(chamadasTabela('sessoes', 'GET')[0].query.status).toBe('eq.aberta');
    expect(chamadasRpc('listar_mesas_balcao').length).toBeGreaterThan(0);
  });

  it('mostra o card do pedido (mesa, cliente, itens, total) e o contador', async () => {
    preparar({ pedidos: [PEDIDO] });
    renderPagina(<Balcao />);

    const card = (await screen.findByText('Mesa 3', { selector: '.pedido-card__mesa' })).closest('.pedido-card') as HTMLElement;
    expect(within(card).getByText('Ana')).toBeInTheDocument();
    expect(within(card).getByText('2x Caipirinha')).toBeInTheDocument();
    expect(within(card).getByText('1x Água')).toBeInTheDocument();
    expect(card.querySelector('.pedido-card__total')!.textContent!.replace(/\s/g, ' ')).toBe('Total: R$ 45,00');
    expect(document.querySelector('.balcao-header__contador strong')).toHaveTextContent('1');
  });

  it('sem nada pendente mostra as mensagens de vazio', async () => {
    preparar();
    renderPagina(<Balcao />);
    expect(await screen.findByText('Nenhum pedido pendente no momento.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma mesa ocupada no momento.')).toBeInTheDocument();
  });

  it('erro de carga NÃO finge que está vazio: avisa e "Tentar novamente" recarrega', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logadoComo('balcao');
    let falhar = true;
    mockTabela('pedidos', { select: () => (falhar ? (new ErroPg('boom', { status: 500 }) as never) : [PEDIDO]) });
    mockTabela('pagamentos', { select: [] });
    mockTabela('sessoes', { select: [] });
    mockRpc('listar_mesas_balcao', MESAS);
    renderPagina(<Balcao />);

    expect(await screen.findByText(/Isso NÃO significa que não há pedidos/)).toBeInTheDocument();
    expect(screen.queryByText('Nenhum pedido pendente no momento.')).not.toBeInTheDocument();

    falhar = false;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText(/Isso NÃO significa/)).not.toBeInTheDocument();
  });

  it('sem sessão mostra o login e não faz nenhuma consulta de dados', async () => {
    mockTabela('pedidos', { select: [PEDIDO] });
    renderPagina(<Balcao />);
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(chamadasTabela('pedidos')).toHaveLength(0);
  });
});

describe('Balcão — fila de pedidos (MSW)', () => {
  it('"Entregue" faz PATCH { status: entregue } só naquele pedido e o card some', async () => {
    preparar({ pedidos: [PEDIDO] });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Entregue' }));

    await waitFor(() => expect(screen.queryByText('Ana')).not.toBeInTheDocument());
    const patch = chamadasTabela('pedidos', 'PATCH')[0];
    expect(patch.query.id).toBe('eq.ped-1');
    expect(patch.body).toEqual({ status: 'entregue' });
  });

  it('falha ao marcar entregue avisa e mantém o pedido na fila', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    preparar({ pedidos: [PEDIDO] });
    mockTabela('pedidos', { select: ({ query }) => (query.status === 'eq.pendente' && query.tipo === 'eq.pedido' ? [PEDIDO] : []), update: new ErroPg('boom', { status: 500 }) as never });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Entregue' }));

    await waitFor(() => expect(alerta).toHaveBeenCalledWith(expect.stringContaining('Não foi possível marcar como entregue')));
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('remover item exige a senha: senha errada não chama a RPC', async () => {
    preparar({ pedidos: [PEDIDO] });
    mockRpc('remover_item_pedido', null);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remover Água' }));

    senhaIncorreta();
    await digitarSenha('errada');
    expect(await screen.findByText('Senha incorreta.')).toHaveClass('show');
    expect(chamadasRpc('remover_item_pedido')).toHaveLength(0);
    expect(screen.getByText('1x Água')).toBeInTheDocument();
  });

  it('senha correta remove o item (RPC) e recalcula o total do card', async () => {
    preparar({ pedidos: [PEDIDO] });
    mockRpc('remover_item_pedido', null);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remover Água' }));
    await digitarSenha('certa');

    await waitFor(() => expect(chamadasRpc('remover_item_pedido')).toHaveLength(1));
    expect(chamadasRpc('remover_item_pedido')[0].body).toEqual({ p_pedido_id: 'ped-1', p_item_id: 12 });
    await waitFor(() => expect(screen.queryByText('1x Água')).not.toBeInTheDocument());
    expect(document.querySelector('.pedido-card__total')!.textContent!.replace(/\s/g, ' ')).toBe('Total: R$ 40,00');
  });

  it('remover o último item tira o pedido inteiro da fila', async () => {
    const umItem = { ...PEDIDO, itens: [{ id: 11, nome: 'Caipirinha', preco: 20, quantidade: 2 }], total: 40 };
    preparar({ pedidos: [umItem] });
    mockRpc('remover_item_pedido', null);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remover Caipirinha' }));
    await digitarSenha('certa');
    await waitFor(() => expect(screen.queryByText('Ana')).not.toBeInTheDocument());
    expect(screen.getByText('Nenhum pedido pendente no momento.')).toBeInTheDocument();
  });
});

describe('Balcão — fechar conta e pagamentos (MSW)', () => {
  it('card de fechamento mostra itens, resumo e o valor a cobrar (saldo restante)', async () => {
    preparar({ fechamentos: [FECHAMENTO], sessoes: [SESSAO] });
    renderPagina(<Balcao />);
    const card = (await screen.findByText('MESA 3 — FECHAR CONTA')).closest('.fechamento-card') as HTMLElement;

    expect(await within(card).findByText('2x Caipirinha')).toBeInTheDocument();
    expect(card.querySelector('.fechamento-card__total')!.textContent!.replace(/\s/g, ' ')).toBe('A cobrar (saldo restante): R$ 34,00');
    expect(chamadasRpc('conta_da_mesa_balcao')[0].body).toEqual({ p_mesa: 3 });
  });

  it('avisa quando a mesa ainda tem pedidos não entregues', async () => {
    preparar({ fechamentos: [FECHAMENTO], pedidos: [PEDIDO] });
    renderPagina(<Balcao />);
    expect(await screen.findByText('⚠️ Esta mesa tem 1 pedido(s) ainda não entregue(s)')).toBeInTheDocument();
  });

  it('"Conta Fechada" encerra a sessão (p_forcar=false) e remove a mesa da tela', async () => {
    preparar({ fechamentos: [FECHAMENTO], sessoes: [SESSAO] });
    mockRpc('encerrar_sessao', null);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Conta Fechada' }));

    await waitFor(() => expect(chamadasRpc('encerrar_sessao')).toHaveLength(1));
    expect(chamadasRpc('encerrar_sessao')[0].body).toEqual({ p_mesa: 3, p_forcar: false });
    await waitFor(() => expect(screen.queryByText('MESA 3 — FECHAR CONTA')).not.toBeInTheDocument());
    expect(screen.getByText('Nenhuma mesa ocupada no momento.')).toBeInTheDocument();
  });

  it('com pedidos não entregues pede confirmação; cancelar não encerra', async () => {
    preparar({ fechamentos: [FECHAMENTO], pedidos: [PEDIDO], sessoes: [SESSAO] });
    mockRpc('encerrar_sessao', null);
    const confirma = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Conta Fechada' }));

    expect(confirma).toHaveBeenCalledWith(expect.stringContaining('1 pedido(s) ainda não entregue(s)'));
    expect(chamadasRpc('encerrar_sessao')).toHaveLength(0);
    expect(screen.getByText('MESA 3 — FECHAR CONTA')).toBeInTheDocument();
  });

  it('saldo pendente: servidor recusa, o balcão pergunta e só então força (p_forcar=true)', async () => {
    preparar({ fechamentos: [FECHAMENTO], sessoes: [SESSAO] });
    mockRpc('encerrar_sessao', ({ body }) => ((body as { p_forcar: boolean }).p_forcar ? null : new ErroPg('Ainda falta receber R$ 34,00 de Ana.')));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Conta Fechada' }));

    await waitFor(() => expect(chamadasRpc('encerrar_sessao')).toHaveLength(2));
    expect(chamadasRpc('encerrar_sessao').map((c) => (c.body as { p_forcar: boolean }).p_forcar)).toEqual([false, true]);
    await waitFor(() => expect(screen.queryByText('MESA 3 — FECHAR CONTA')).not.toBeInTheDocument());
  });

  it('saldo pendente e o balcão recusa forçar: a conta continua aberta', async () => {
    preparar({ fechamentos: [FECHAMENTO], sessoes: [SESSAO] });
    mockRpc('encerrar_sessao', new ErroPg('Ainda falta receber R$ 34,00 de Ana.'));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Conta Fechada' }));

    await waitFor(() => expect(chamadasRpc('encerrar_sessao')).toHaveLength(1));
    expect(screen.getByText('MESA 3 — FECHAR CONTA')).toBeInTheDocument();
  });

  it('pagamento parcial: mostra quem quer fechar, itens (com fração compartilhada) e aviso de taxa recusada', async () => {
    preparar({ pagamentos: [PAGAMENTO], sessoes: [SESSAO] });
    renderPagina(<Balcao />);
    const card = (await screen.findByText(/quer fechar/)).closest('.pagamento-card') as HTMLElement;

    expect(card.textContent).toContain('MESA 3');
    expect(within(card).getByText('Bia')).toBeInTheDocument();
    expect(within(card).getByText('⚠️ Recusou a taxa de serviço')).toBeInTheDocument();
    expect(await within(card).findByText('2x Chopp')).toBeInTheDocument();
    expect(within(card).getByText('Narguilé (fração compartilhada)')).toBeInTheDocument();
    expect(chamadasRpc('detalhe_pagamento')[0].body).toEqual({ p_pagamento_id: 'pag-1' });
  });

  it('"Recebido" confirma via RPC e tira o card', async () => {
    preparar({ pagamentos: [PAGAMENTO], sessoes: [SESSAO] });
    mockRpc('confirmar_pagamento', { sessao_encerrada: false, mesa: 3 });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Recebido' }));

    await waitFor(() => expect(chamadasRpc('confirmar_pagamento')).toHaveLength(1));
    expect(chamadasRpc('confirmar_pagamento')[0].body).toEqual({ p_pagamento_id: 'pag-1' });
    await waitFor(() => expect(screen.queryByText(/quer fechar/)).not.toBeInTheDocument());
    expect(screen.getByText('Mesa 3', { selector: '.mesa-ativa-card__mesa' })).toBeInTheDocument(); // sessão segue aberta
  });

  it('último pagamento quita a mesa: sessão encerra sozinha, mesa sai de "Mesas Ativas" e aparece o aviso', async () => {
    preparar({ pagamentos: [PAGAMENTO], sessoes: [SESSAO], pedidos: [PEDIDO], fechamentos: [FECHAMENTO] });
    mockRpc('confirmar_pagamento', { sessao_encerrada: true, mesa: 3 });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Recebido' }));

    await waitFor(() => expect(toast()).toHaveTextContent('Mesa 3 quitada e encerrada automaticamente.'));
    await waitFor(() => expect(screen.queryByText('Mesa 3', { selector: '.mesa-ativa-card__mesa' })).not.toBeInTheDocument());
    expect(screen.queryByText('MESA 3 — FECHAR CONTA')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument(); // pedidos da mesa saem da fila
  });

  it('falha ao confirmar pagamento avisa e mantém o card', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    preparar({ pagamentos: [PAGAMENTO], sessoes: [SESSAO] });
    mockRpc('confirmar_pagamento', new ErroPg('boom', { status: 500 }));
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Recebido' }));
    await waitFor(() => expect(alerta).toHaveBeenCalledWith(expect.stringContaining('Não foi possível marcar como recebido')));
    expect(screen.getByText(/quer fechar/)).toBeInTheDocument();
  });
});

describe('Balcão — mesas ativas (MSW)', () => {
  it('card da mesa mostra horário, itens e Total/Pago/Falta', async () => {
    preparar({ sessoes: [SESSAO] });
    renderPagina(<Balcao />);
    const card = (await screen.findByText('Mesa 3', { selector: '.mesa-ativa-card__mesa' })).closest('.mesa-ativa-card') as HTMLElement;
    expect(await within(card).findByText('2x Caipirinha')).toBeInTheDocument();
    expect(card.querySelector('.falta')!.textContent!.replace(/\s/g, ' ')).toBe('Falta R$ 34,00');
  });

  it('"Fechar mesa" exige senha e depois encerra a sessão', async () => {
    preparar({ sessoes: [SESSAO] });
    mockRpc('encerrar_sessao', null);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar mesa' }));
    expect(chamadasRpc('encerrar_sessao')).toHaveLength(0); // ainda não: falta a senha

    await digitarSenha('certa');
    await waitFor(() => expect(chamadasRpc('encerrar_sessao')).toHaveLength(1));
    expect(chamadasRpc('encerrar_sessao')[0].body).toEqual({ p_mesa: 3, p_forcar: false });
    await waitFor(() => expect(screen.queryByText('Mesa 3', { selector: '.mesa-ativa-card__mesa' })).not.toBeInTheDocument());
  });

  it('senha errada em "Fechar mesa" não encerra nada', async () => {
    preparar({ sessoes: [SESSAO] });
    mockRpc('encerrar_sessao', null);
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar mesa' }));
    senhaIncorreta();
    await digitarSenha('errada');
    expect(await screen.findByText('Senha incorreta.')).toHaveClass('show');
    expect(chamadasRpc('encerrar_sessao')).toHaveLength(0);
  });
});

/** Consultas de histórico: pedidos tipo=pedido SEM filtro de status (a fila usa status=pendente). */
const consultasHistorico = () => chamadasTabela('pedidos', 'GET').filter((c) => c.query.tipo === 'eq.pedido' && !c.query.status);

describe('Balcão — histórico (MSW)', () => {
  const HIST = [
    { id: 'h1', mesa: 7, total: 30, status: 'entregue', criado_em: '2026-03-01T22:00:00Z', itens: [{ nome: 'Chopp', preco: 15, quantidade: 2 }] },
  ];

  it('abre o modal e busca os pedidos dos últimos 30 dias (tipo=pedido, intervalo gte/lt, mais recentes primeiro)', async () => {
    preparar({ historico: HIST });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico' }));

    expect(await screen.findByText('Mesa 7')).toBeInTheDocument();
    expect(screen.getByText('Entregue')).toBeInTheDocument();
    const c = consultasHistorico().at(-1)!;
    expect(c.query.tipo).toBe('eq.pedido');
    expect(c.query.order).toBe('criado_em.desc');
    const [gte, lt] = c.search.getAll('criado_em');
    expect(gte).toMatch(/^gte\./);
    expect(lt).toMatch(/^lt\./);
    // intervalo de ~30 dias, terminando na meia-noite de amanhã (inclui hoje inteiro)
    const dias = (new Date(lt.slice(3)).getTime() - new Date(gte.slice(4)).getTime()) / 86_400_000;
    expect(Math.round(dias)).toBe(30);
  });

  it('filtrar por data envia o intervalo daquele dia; "Limpar" volta aos 30 dias', async () => {
    preparar({ historico: HIST });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico' }));
    await screen.findByText('Mesa 7');

    await userEvent.type(screen.getByLabelText('Filtrar por data:'), '2026-03-10');
    await waitFor(() => expect(consultasHistorico().length).toBeGreaterThan(1));
    const [gte, lt] = consultasHistorico().at(-1)!.search.getAll('criado_em');
    expect(new Date(gte.slice(4)).getTime()).toBe(new Date(2026, 2, 10).getTime());
    expect(new Date(lt.slice(3)).getTime()).toBe(new Date(2026, 2, 11).getTime());

    const antes = consultasHistorico().length;
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(screen.getByLabelText('Filtrar por data:')).toHaveValue(''));
    await waitFor(() => expect(consultasHistorico().length).toBeGreaterThan(antes));
  });

  it('sem resultados mostra a mensagem apropriada', async () => {
    preparar({ historico: [] });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico' }));
    expect(await screen.findByText('Nenhum pedido nos últimos 30 dias.')).toBeInTheDocument();
  });

  it('erro de rede no histórico é avisado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    preparar();
    mockTabela('pedidos', { select: ({ query }) => (query.tipo === 'eq.pedido' && !query.status ? (new ErroPg('boom', { status: 500 }) as never) : []) });
    renderPagina(<Balcao />);
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico' }));
    expect(await screen.findByText(/Não foi possível carregar o histórico/)).toBeInTheDocument();
  });
});

describe('Balcão — controle de mesas (MSW)', () => {
  async function abrirControle() {
    await userEvent.click(await screen.findByRole('button', { name: 'Mesas' }));
    return (await screen.findByText('Controle de Mesas')).closest('.modal-panel') as HTMLElement;
  }
  const cardMesa = (modal: HTMLElement, n: number) => within(modal).getByText(`Mesa ${n}`).closest('.controle-mesa-card') as HTMLElement;

  it('lista todas as mesas com status: liberada, bloqueada e inativa; marca "Sessão aberta"', async () => {
    preparar({ sessoes: [SESSAO] });
    renderPagina(<Balcao />);
    const modal = await abrirControle();

    expect(within(cardMesa(modal, 1)).getByText('Liberada')).toBeInTheDocument();
    expect(within(cardMesa(modal, 2)).getByText('Bloqueada')).toBeInTheDocument();
    expect(within(cardMesa(modal, 4)).getByText('Inativa')).toBeInTheDocument();
    expect(within(cardMesa(modal, 3)).getByText('Sessão aberta')).toBeInTheDocument();
    expect(within(cardMesa(modal, 1)).queryByRole('button', { name: 'Liberar mesa' })).not.toBeInTheDocument(); // só bloqueadas
  });

  it('"Liberar mesa" chama liberar_mesa e passa a Liberada', async () => {
    preparar();
    mockRpc('liberar_mesa', null);
    renderPagina(<Balcao />);
    const modal = await abrirControle();
    await userEvent.click(within(cardMesa(modal, 2)).getByRole('button', { name: 'Liberar mesa' }));

    await waitFor(() => expect(chamadasRpc('liberar_mesa')).toHaveLength(1));
    expect(chamadasRpc('liberar_mesa')[0].body).toEqual({ p_mesa: 2 });
    await waitFor(() => expect(within(cardMesa(modal, 2)).getByText('Liberada')).toBeInTheDocument());
  });

  it('desativar pede confirmação; ativar mesa inativa chama ativar_mesa', async () => {
    preparar();
    mockRpc('desativar_mesa', null);
    mockRpc('ativar_mesa', null);
    const confirma = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPagina(<Balcao />);
    const modal = await abrirControle();

    await userEvent.click(within(cardMesa(modal, 1)).getByRole('button', { name: 'Desativar' }));
    expect(chamadasRpc('desativar_mesa')).toHaveLength(0);
    await userEvent.click(within(cardMesa(modal, 1)).getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(chamadasRpc('desativar_mesa')).toHaveLength(1));
    expect(chamadasRpc('desativar_mesa')[0].body).toEqual({ p_mesa: 1 });
    expect(confirma).toHaveBeenCalledTimes(2);

    await userEvent.click(within(cardMesa(modal, 4)).getByRole('button', { name: 'Ativar mesa' }));
    await waitFor(() => expect(chamadasRpc('ativar_mesa')[0]?.body).toEqual({ p_mesa: 4 }));
  });

  it('"Liberar todas" confirma, chama a RPC em massa e informa quantas foram liberadas', async () => {
    preparar();
    mockRpc('liberar_todas_mesas', 2);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Balcao />);
    const modal = await abrirControle();
    await userEvent.click(within(modal).getByRole('button', { name: 'Liberar todas' }));

    await waitFor(() => expect(chamadasRpc('liberar_todas_mesas')).toHaveLength(1));
    await waitFor(() => expect(toast()).toHaveTextContent('2 mesas liberadas.'));
  });

  it('"Bloquear todas": mesas com conta aberta são puladas; confirmar de novo força (p_forcar=true)', async () => {
    preparar();
    mockRpc('bloquear_todas_mesas', ({ body }) => ((body as { p_forcar: boolean }).p_forcar ? { bloqueadas: 1, puladas: 0 } : { bloqueadas: 2, puladas: 1 }));
    const confirma = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPagina(<Balcao />);
    const modal = await abrirControle();
    await userEvent.click(within(modal).getByRole('button', { name: 'Bloquear todas' }));

    await waitFor(() => expect(chamadasRpc('bloquear_todas_mesas')).toHaveLength(2));
    expect(chamadasRpc('bloquear_todas_mesas').map((c) => (c.body as { p_forcar: boolean }).p_forcar)).toEqual([false, true]);
    expect(confirma).toHaveBeenLastCalledWith(expect.stringContaining('conta aberta'));
    await waitFor(() => expect(toast()).toHaveTextContent('1 mesa bloqueada (incluindo com conta aberta).'));
  });

  it('"Bloquear todas": recusar a segunda confirmação não força', async () => {
    preparar();
    mockRpc('bloquear_todas_mesas', { bloqueadas: 2, puladas: 1 });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
    renderPagina(<Balcao />);
    const modal = await abrirControle();
    await userEvent.click(within(modal).getByRole('button', { name: 'Bloquear todas' }));

    await waitFor(() => expect(toast()).toHaveTextContent('com conta aberta não foi mexida'));
    expect(chamadasRpc('bloquear_todas_mesas')).toHaveLength(1);
  });
});
