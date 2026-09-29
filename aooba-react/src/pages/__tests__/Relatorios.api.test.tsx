import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ErroPg, chamadasRpc, chamadasTabela, logadoComo, mockRpc, mockTabela } from '../../test/msw';
import { renderPagina } from '../../test/render';
import { formatarDataISO } from '../../lib/shared';

// Chart.js precisa de canvas real; aqui só interessa o que a página manda pros gráficos.
vi.mock('react-chartjs-2', () => ({
  Line: (p: { data: unknown }) => <pre data-testid="grafico-linha">{JSON.stringify(p.data)}</pre>,
  Doughnut: (p: { data: unknown }) => <pre data-testid="grafico-rosca">{JSON.stringify(p.data)}</pre>,
  Bar: (p: { data: unknown }) => <pre data-testid="grafico-barra">{JSON.stringify(p.data)}</pre>,
}));

import Relatorios from '../Relatorios';

const POR_DIA = [
  { dia: '2026-03-01', faturamento: 100 },
  { dia: '2026-03-02', faturamento: 250.5 },
];
const MAIS_VENDIDOS = [
  { nome: 'Caipirinha', quantidade: 10, receita: 200 },
  { nome: 'Chopp', quantidade: 30, receita: 150.5 },
];
const TICKET_MESA = [
  { mesa: 1, pedidos: 3, ticket_medio: 80 },
  { mesa: 2, pedidos: 2, ticket_medio: 55.25 },
];
const POR_CATEGORIA = [
  { categoria: 'cerveja', receita: 150.5 },
  { categoria: 'drink', receita: 200 },
];
const POR_HORA = [
  { hora: 20, pedidos: 2 },
  { hora: 21, pedidos: 5 },
];

function mockRelatorios(sobrescrever: Partial<Record<string, unknown>> = {}) {
  logadoComo('admin');
  const dados: Record<string, unknown> = {
    faturamento_por_dia: POR_DIA,
    produtos_mais_vendidos: MAIS_VENDIDOS,
    ticket_medio_por_mesa: TICKET_MESA,
    vendas_por_categoria: POR_CATEGORIA,
    movimento_por_hora: POR_HORA,
    ...sobrescrever,
  };
  for (const [nome, valor] of Object.entries(dados)) mockRpc(nome, valor);
}

const RPCS = ['faturamento_por_dia', 'produtos_mais_vendidos', 'ticket_medio_por_mesa', 'vendas_por_categoria', 'movimento_por_hora'];
// jsdom não implementa Blob.stream()/arrayBuffer(); FileReader funciona.
const lerBytes = (blob: Blob) =>
  new Promise<Uint8Array>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => erro(r.error);
    r.readAsArrayBuffer(blob);
  });
const norm = (t: string | null) => (t ?? '').replace(/\s/g, ' ');

describe('Relatórios — API (MSW)', () => {
  it('ao abrir carrega "Últimos 7 dias" chamando as 5 RPCs com o intervalo (hoje-6 .. hoje)', async () => {
    mockRelatorios();
    renderPagina(<Relatorios />);
    await screen.findByText('Faturamento total');

    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 6);
    for (const nome of RPCS) {
      expect(chamadasRpc(nome)).toHaveLength(1);
      expect(chamadasRpc(nome)[0].body).toMatchObject({ p_data_inicio: formatarDataISO(inicio), p_data_fim: formatarDataISO(hoje) });
    }
    expect(chamadasRpc('produtos_mais_vendidos')[0].body).toMatchObject({ p_limite: 100 });
  });

  it('calcula os cartões: faturamento, pedidos, ticket médio e item campeão', async () => {
    mockRelatorios();
    renderPagina(<Relatorios />);
    const valor = async (rotulo: string) => (await screen.findByText(rotulo, { selector: '.rel-card__label' })).parentElement!.querySelector('.rel-card__valor')!.textContent;

    expect(norm(await valor('Faturamento total'))).toBe('R$ 350,50'); // 100 + 250,5
    expect(await valor('Pedidos')).toBe('5'); // 3 + 2
    expect(norm(await valor('Ticket médio'))).toBe('R$ 70,10'); // 350,5 / 5
    expect(await valor('Item campeão')).toBe('Caipirinha'); // primeiro da lista do servidor
  });

  it('alimenta os gráficos: dias em dd/mm, categorias na ordem do cardápio, horas com pico', async () => {
    mockRelatorios();
    renderPagina(<Relatorios />);

    const linha = JSON.parse((await screen.findByTestId('grafico-linha')).textContent!);
    expect(linha.labels).toEqual(['01/03', '02/03']);
    expect(linha.datasets[0].data).toEqual([100, 250.5]);

    const rosca = JSON.parse(screen.getByTestId('grafico-rosca').textContent!);
    expect(rosca.labels).toEqual(['Drinks', 'Cervejas']); // ordem: drink antes de cerveja
    expect(rosca.datasets[0].data).toEqual([200, 150.5]);

    const barra = JSON.parse(screen.getByTestId('grafico-barra').textContent!);
    expect(barra.labels).toEqual(['20h', '21h']);
    expect(screen.getByText('Pico às 21h')).toBeInTheDocument();
  });

  it('tabela "mais vendidos" ordena por quantidade desc e inverte ao clicar de novo', async () => {
    mockRelatorios();
    renderPagina(<Relatorios />);
    const tabela = (await screen.findByText('Mais vendidos')).closest('section') as HTMLElement;
    const nomes = () => within(tabela).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);

    expect(nomes()).toEqual(['Chopp', 'Caipirinha']); // 30 > 10

    await userEvent.click(within(tabela).getByRole('columnheader', { name: 'Qtd.' }));
    expect(nomes()).toEqual(['Caipirinha', 'Chopp']);

    await userEvent.click(within(tabela).getByRole('columnheader', { name: 'Produto' }));
    expect(nomes()).toEqual(['Caipirinha', 'Chopp']); // nome asc
    await userEvent.click(within(tabela).getByRole('columnheader', { name: 'Produto' }));
    expect(nomes()).toEqual(['Chopp', 'Caipirinha']); // nome desc
  });

  it('atalho "Hoje" refaz as RPCs com início = fim = hoje', async () => {
    mockRelatorios();
    renderPagina(<Relatorios />);
    await screen.findByText('Faturamento total');

    await userEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    await waitFor(() => expect(chamadasRpc('faturamento_por_dia')).toHaveLength(2));
    const hoje = formatarDataISO(new Date());
    expect(chamadasRpc('faturamento_por_dia')[1].body).toMatchObject({ p_data_inicio: hoje, p_data_fim: hoje });
  });

  it('período personalizado com datas invertidas é normalizado (início <= fim)', async () => {
    mockRelatorios();
    renderPagina(<Relatorios />);
    await screen.findByText('Faturamento total');

    const de = screen.getByLabelText('De');
    const ate = screen.getByLabelText('Até');
    await userEvent.clear(de);
    await userEvent.type(de, '2026-03-20');
    await userEvent.clear(ate);
    await userEvent.type(ate, '2026-03-10');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => expect(chamadasRpc('faturamento_por_dia')).toHaveLength(2));
    expect(chamadasRpc('faturamento_por_dia')[1].body).toMatchObject({ p_data_inicio: '2026-03-10', p_data_fim: '2026-03-20' });
    expect(de).toHaveValue('2026-03-10');
  });

  it('sem pedidos no período mostra o estado vazio (sem cartões)', async () => {
    mockRelatorios({ ticket_medio_por_mesa: [], faturamento_por_dia: [], produtos_mais_vendidos: [] });
    renderPagina(<Relatorios />);
    expect(await screen.findByText('Nenhum pedido registrado nesse período.')).toBeInTheDocument();
    expect(screen.queryByText('Faturamento total')).not.toBeInTheDocument();
  });

  it('se UMA das 5 RPCs falha, mostra erro e "Tentar novamente" recarrega tudo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRelatorios();
    let falhar = true;
    mockRpc('movimento_por_hora', () => (falhar ? new ErroPg('boom', { status: 500 }) : POR_HORA));
    renderPagina(<Relatorios />);

    const tentar = await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByText('Faturamento total')).not.toBeInTheDocument();

    falhar = false;
    await userEvent.click(tentar);
    expect(await screen.findByText('Faturamento total')).toBeInTheDocument();
  });

  it('exportar CSV gera arquivo com BOM, cabeçalho e linhas na ordem exibida', async () => {
    mockRelatorios();
    let blobGerado: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => ((blobGerado = b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPagina(<Relatorios />);

    await userEvent.click(await screen.findByRole('button', { name: 'Exportar CSV' }));
    const bytes = await lerBytes(blobGerado!);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 (Excel)
    const texto = new TextDecoder().decode(bytes.slice(3));
    expect(texto.split('\r\n')).toEqual(['Produto;Quantidade;Receita (R$)', '"Chopp";30;"150,50"', '"Caipirinha";10;"200,00"']);
  });

  it('backup completo busca produtos, pedidos e itens paginando e baixa um .zip', async () => {
    mockRelatorios();
    mockTabela('produtos', { select: [{ id: 1, nome: 'Caipirinha', descricao: '', preco: 20, categoria: 'drink', ativo: true, ordem: 1 }] });
    mockTabela('pedidos', { select: [{ id: 'p1', tipo: 'pedido', mesa: 1, cliente_nome: 'Ana', total: 20, status: 'entregue', origem: 'cliente', criado_em: '2026-03-01T22:00:00Z' }] });
    mockTabela('pedido_itens', { select: [{ id: 1, pedido_id: 'p1', nome_snapshot: 'Caipirinha', preco_unitario: 20, quantidade: 1, compartilhado: false }] });
    URL.createObjectURL = vi.fn(() => 'blob:zip');
    URL.revokeObjectURL = vi.fn();
    let nomeArquivo = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      nomeArquivo = this.download;
    });
    renderPagina(<Relatorios />);

    await userEvent.click(await screen.findByRole('button', { name: 'Baixar backup completo' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

    for (const t of ['produtos', 'pedidos', 'pedido_itens']) {
      const get = chamadasTabela(t, 'GET').find((c) => c.query.select === '*')!;
      expect(get).toBeDefined();
      expect(get.query.order).toBe('id.asc');
    }
    expect(nomeArquivo).toMatch(/^backup-aooba_\d{4}-\d{2}-\d{2}\.zip$/);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.size).toBeGreaterThan(100);
  });

  it('falha no backup avisa o usuário e reabilita o botão', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const alerta = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockRelatorios();
    mockTabela('produtos', { select: new ErroPg('boom', { status: 500 }) as never });
    mockTabela('pedidos', { select: [] });
    mockTabela('pedido_itens', { select: [] });
    renderPagina(<Relatorios />);

    const botao = await screen.findByRole('button', { name: 'Baixar backup completo' });
    await userEvent.click(botao);
    await waitFor(() => expect(alerta).toHaveBeenCalledWith(expect.stringContaining('Não foi possível gerar o backup')));
    expect(botao).toBeEnabled();
  });

  it('não consulta relatórios sem estar logado como admin', async () => {
    logadoComo('balcao');
    for (const nome of RPCS) mockRpc(nome, []);
    renderPagina(<Relatorios />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    for (const nome of RPCS) expect(chamadasRpc(nome)).toHaveLength(0);
  });
});
