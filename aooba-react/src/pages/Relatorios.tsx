import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { AdminLayout } from '../components/AdminLayout';
import { supabase } from '../lib/supabase';
import { baixarArquivo, baixarBackupCompleto } from '../lib/backup';
import { formatarDataISO, formatarPreco, LABEL_CATEGORIA, ORDEM_CATEGORIAS } from '../lib/shared';
import type { Categoria } from '../lib/types';
import '../styles/relatorios.css';

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

const CORES_CATEGORIA: Record<Categoria, string> = {
  drink: '#3987e5',
  cerveja: '#d95926',
  sem_alcool: '#199e70',
  narguile: '#c98500',
  essencia: '#d55181',
};
const COR_TEXTO = '#c9c9c9';
const COR_GRADE = 'rgba(255, 255, 255, 0.06)';
const COR_FUNDO = '#161616';
const COR_BORDA = 'rgba(255, 255, 255, 0.15)';

const tooltipBase = {
  backgroundColor: COR_FUNDO,
  borderColor: COR_BORDA,
  borderWidth: 1,
  titleColor: '#FFFFFF',
  bodyColor: COR_TEXTO,
  padding: 10,
};

interface Dia { dia: string; faturamento: number | string }
interface MaisVendido { nome: string; quantidade: number; receita: number | string }
interface TicketMesa { mesa: number; pedidos: number | string; ticket_medio: number | string }
interface PorCategoria { categoria: Categoria; receita: number | string }
interface PorHora { hora: number; pedidos: number | string }

interface Dados {
  porDia: Dia[];
  maisVendidos: MaisVendido[];
  ticketMesa: TicketMesa[];
  porCategoria: PorCategoria[];
  porHora: PorHora[];
}

type Atalho = 'hoje' | '7dias' | '30dias' | 'mes';
const ATALHOS: { id: Atalho; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7dias', label: 'Últimos 7 dias' },
  { id: '30dias', label: 'Últimos 30 dias' },
  { id: 'mes', label: 'Mês atual' },
];

function calcularAtalho(tipo: Atalho) {
  const hoje = new Date();
  const fim = new Date(hoje);
  let inicio = new Date(hoje);
  if (tipo === '7dias') inicio.setDate(inicio.getDate() - 6);
  else if (tipo === '30dias') inicio.setDate(inicio.getDate() - 29);
  else if (tipo === 'mes') inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return { inicio: formatarDataISO(inicio), fim: formatarDataISO(fim) };
}

const dataCurta = (iso: string) => {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
};

type Campo = 'nome' | 'quantidade' | 'receita';

function Conteudo() {
  const [atalho, setAtalho] = useState<Atalho | null>('7dias');
  const [periodo, setPeriodo] = useState(() => calcularAtalho('7dias'));
  const [inicioInput, setInicioInput] = useState(periodo.inicio);
  const [fimInput, setFimInput] = useState(periodo.fim);
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [ordenacao, setOrdenacao] = useState<{ campo: Campo; direcao: 'asc' | 'desc' }>({ campo: 'quantidade', direcao: 'desc' });
  const [gerandoBackup, setGerandoBackup] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    const params = { p_data_inicio: periodo.inicio, p_data_fim: periodo.fim };
    const [r1, r2, r3, r4, r5] = await Promise.all([
      supabase.rpc('faturamento_por_dia', params),
      supabase.rpc('produtos_mais_vendidos', { ...params, p_limite: 100 }),
      supabase.rpc('ticket_medio_por_mesa', params),
      supabase.rpc('vendas_por_categoria', params),
      supabase.rpc('movimento_por_hora', params),
    ]);
    const e = r1.error || r2.error || r3.error || r4.error || r5.error;
    if (e) {
      console.error('Erro ao carregar relatório:', e);
      setErro(true);
    } else {
      setDados({
        porDia: r1.data as Dia[],
        maisVendidos: r2.data as MaisVendido[],
        ticketMesa: r3.data as TicketMesa[],
        porCategoria: r4.data as PorCategoria[],
        porHora: r5.data as PorHora[],
      });
    }
    setCarregando(false);
  }, [periodo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function escolherAtalho(id: Atalho) {
    const p = calcularAtalho(id);
    setAtalho(id);
    setInicioInput(p.inicio);
    setFimInput(p.fim);
    setPeriodo(p);
  }

  function aplicarCustom(e: FormEvent) {
    e.preventDefault();
    if (!inicioInput || !fimInput) return;
    let [inicio, fim] = [inicioInput, fimInput];
    if (inicio > fim) [inicio, fim] = [fim, inicio];
    setInicioInput(inicio);
    setFimInput(fim);
    setAtalho(null);
    setPeriodo({ inicio, fim });
  }

  const maisVendidosOrdenados = useMemo(() => {
    if (!dados) return [];
    const mult = ordenacao.direcao === 'asc' ? 1 : -1;
    return [...dados.maisVendidos].sort((a, b) =>
      ordenacao.campo === 'nome' ? a.nome.localeCompare(b.nome) * mult : (Number(a[ordenacao.campo]) - Number(b[ordenacao.campo])) * mult,
    );
  }, [dados, ordenacao]);

  function ordenarPor(campo: Campo) {
    setOrdenacao((o) => (o.campo === campo ? { campo, direcao: o.direcao === 'asc' ? 'desc' : 'asc' } : { campo, direcao: campo === 'nome' ? 'asc' : 'desc' }));
  }

  function exportarCsv() {
    if (maisVendidosOrdenados.length === 0) return;
    const corpo = maisVendidosOrdenados
      .map((i) => {
        const nome = String(i.nome).replace(/"/g, '""');
        const receita = Number(i.receita).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `"${nome}";${i.quantidade};"${receita}"`;
      })
      .join('\r\n');
    const csv = '﻿Produto;Quantidade;Receita (R$)\r\n' + corpo;
    baixarArquivo(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `relatorio-mais-vendidos_${periodo.inicio}_a_${periodo.fim}.csv`);
  }

  async function backup() {
    setGerandoBackup(true);
    try {
      await baixarBackupCompleto();
    } catch (e) {
      console.error('Erro ao gerar backup:', e);
      window.alert('Não foi possível gerar o backup agora. Verifique sua conexão e tente de novo.');
    } finally {
      setGerandoBackup(false);
    }
  }

  const resumo = useMemo(() => {
    if (!dados) return null;
    const pedidos = dados.ticketMesa.reduce((acc, m) => acc + Number(m.pedidos), 0);
    const faturamento = dados.porDia.reduce((acc, d) => acc + Number(d.faturamento), 0);
    return { pedidos, faturamento, ticket: pedidos ? faturamento / pedidos : 0 };
  }, [dados]);

  const picoHora = useMemo(() => {
    if (!dados) return '';
    const valores = dados.porHora.map((h) => Number(h.pedidos));
    const idx = valores.reduce((melhor, v, i) => (v > valores[melhor] ? i : melhor), 0);
    return valores[idx] > 0 ? `Pico às ${String(dados.porHora[idx].hora).padStart(2, '0')}h` : '';
  }, [dados]);

  const opcoesLinha: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { ...tooltipBase, callbacks: { label: (i) => ` ${formatarPreco(i.parsed.y ?? 0)}` } } },
    scales: {
      x: { ticks: { color: COR_TEXTO }, grid: { color: COR_GRADE } },
      y: { beginAtZero: true, ticks: { color: COR_TEXTO, callback: (v) => formatarPreco(Number(v)) }, grid: { color: COR_GRADE } },
    },
  };

  const categoriasPresentes = dados ? ORDEM_CATEGORIAS.map((c) => dados.porCategoria.find((x) => x.categoria === c)).filter((x): x is PorCategoria => Boolean(x)) : [];

  const opcoesRosca: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: COR_TEXTO, usePointStyle: true, boxWidth: 8, padding: 14 } },
      tooltip: { ...tooltipBase, callbacks: { label: (i) => ` ${i.label}: ${formatarPreco(i.parsed)}` } },
    },
  };

  const opcoesBarra: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { ...tooltipBase, callbacks: { label: (i) => ` ${i.parsed.y} pedido(s)` } } },
    scales: {
      x: { ticks: { color: COR_TEXTO }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: COR_TEXTO, precision: 0 }, grid: { color: COR_GRADE } },
    },
  };

  const vazio = !!resumo && resumo.pedidos === 0;
  const th = (campo: Campo, label: string) => (
    <th
      className={ordenacao.campo === campo ? 'rel-tabela__th--ativo' : undefined}
      data-direcao={ordenacao.campo === campo ? ordenacao.direcao : undefined}
      onClick={() => ordenarPor(campo)}
    >
      {label}
    </th>
  );

  return (
    <>
      <div className="admin-toolbar">
        <h1 className="admin-titulo">Relatórios</h1>
        <div className="rel-backup">
          <button type="button" className="btn btn--secondary" disabled={gerandoBackup} onClick={() => void backup()}>
            {gerandoBackup ? 'Gerando backup...' : 'Baixar backup completo'}
          </button>
          <p className="rel-backup__dica">produtos, pedidos e itens — .zip com .json + .csv</p>
        </div>
      </div>

      <section className="rel-periodo" aria-label="Selecionar período">
        <div className="rel-periodo__atalhos" role="group" aria-label="Atalhos de período">
          {ATALHOS.map((a) => (
            <button key={a.id} type="button" className={`rel-periodo__btn${atalho === a.id ? ' rel-periodo__btn--ativo' : ''}`} onClick={() => escolherAtalho(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
        <form className="rel-periodo__custom" onSubmit={aplicarCustom}>
          <label htmlFor="periodoInicio">De</label>
          <input type="date" id="periodoInicio" required value={inicioInput} onChange={(e) => setInicioInput(e.target.value)} />
          <label htmlFor="periodoFim">Até</label>
          <input type="date" id="periodoFim" required value={fimInput} onChange={(e) => setFimInput(e.target.value)} />
          <button type="submit" className="btn btn--secondary rel-periodo__aplicar">
            Aplicar
          </button>
        </form>
      </section>

      {carregando && <p className="cardapio-status">Carregando relatório...</p>}
      {erro && (
        <div className="cardapio-status cardapio-status--erro">
          <p>Não foi possível carregar o relatório agora. Verifique sua conexão e tente de novo.</p>
          <button type="button" className="btn btn--secondary" onClick={() => void carregar()}>
            Tentar novamente
          </button>
        </div>
      )}
      {!carregando && vazio && (
        <div className="rel-vazio">
          <p>Nenhum pedido registrado nesse período.</p>
          <p className="rel-vazio__dica">Tente escolher um intervalo maior ou conferir se as datas estão corretas.</p>
        </div>
      )}

      {!carregando && !erro && dados && resumo && !vazio && (
        <div>
          <div className="rel-cards">
            <div className="rel-card">
              <span className="rel-card__label">Faturamento total</span>
              <span className="rel-card__valor">{formatarPreco(resumo.faturamento)}</span>
            </div>
            <div className="rel-card">
              <span className="rel-card__label">Pedidos</span>
              <span className="rel-card__valor">{resumo.pedidos.toLocaleString('pt-BR')}</span>
            </div>
            <div className="rel-card">
              <span className="rel-card__label">Ticket médio</span>
              <span className="rel-card__valor">{formatarPreco(resumo.ticket)}</span>
            </div>
            <div className="rel-card">
              <span className="rel-card__label">Item campeão</span>
              <span className="rel-card__valor rel-card__valor--texto">{dados.maisVendidos[0]?.nome ?? '—'}</span>
            </div>
          </div>

          <div className="rel-graficos">
            <div className="rel-painel rel-painel--linha">
              <h2 className="rel-painel__titulo">Faturamento por dia</h2>
              <div className="rel-painel__canvas">
                <Line
                  options={opcoesLinha}
                  data={{
                    labels: dados.porDia.map((d) => dataCurta(d.dia)),
                    datasets: [
                      {
                        label: 'Faturamento',
                        data: dados.porDia.map((d) => Number(d.faturamento)),
                        borderColor: '#FF7A1A',
                        backgroundColor: 'rgba(255, 122, 26, 0.1)',
                        borderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#FF7A1A',
                        pointBorderColor: COR_FUNDO,
                        pointBorderWidth: 2,
                        fill: true,
                        tension: 0.3,
                      },
                    ],
                  }}
                />
              </div>
            </div>
            <div className="rel-painel rel-painel--rosca">
              <h2 className="rel-painel__titulo">Vendas por categoria</h2>
              <div className="rel-painel__canvas">
                <Doughnut
                  options={opcoesRosca}
                  data={{
                    labels: categoriasPresentes.map((c) => LABEL_CATEGORIA[c.categoria] || c.categoria),
                    datasets: [
                      {
                        data: categoriasPresentes.map((c) => Number(c.receita)),
                        backgroundColor: categoriasPresentes.map((c) => CORES_CATEGORIA[c.categoria] || '#8a8a8a'),
                        borderColor: COR_FUNDO,
                        borderWidth: 2,
                        hoverOffset: 6,
                      },
                    ],
                  }}
                />
              </div>
            </div>
          </div>

          <div className="rel-painel rel-painel--hora">
            <h2 className="rel-painel__titulo">
              Movimento por hora<span className="rel-painel__subtitulo">{picoHora}</span>
            </h2>
            <div className="rel-painel__canvas">
              <Bar
                options={opcoesBarra}
                data={{
                  labels: dados.porHora.map((h) => `${String(h.hora).padStart(2, '0')}h`),
                  datasets: [{ label: 'Pedidos', data: dados.porHora.map((h) => Number(h.pedidos)), backgroundColor: '#F5772E', borderRadius: 4, maxBarThickness: 24 }],
                }}
              />
            </div>
          </div>

          <div className="rel-tabelas">
            <section className="rel-tabela-bloco">
              <div className="rel-tabela-bloco__topo">
                <h2 className="rel-painel__titulo">Mais vendidos</h2>
                <button type="button" className="btn btn--secondary" onClick={exportarCsv}>
                  Exportar CSV
                </button>
              </div>
              <div className="rel-tabela-scroll">
                <table className="rel-tabela">
                  <thead>
                    <tr>
                      {th('nome', 'Produto')}
                      {th('quantidade', 'Qtd.')}
                      {th('receita', 'Receita')}
                    </tr>
                  </thead>
                  <tbody>
                    {maisVendidosOrdenados.map((i) => (
                      <tr key={i.nome}>
                        <td>{i.nome}</td>
                        <td>{i.quantidade}</td>
                        <td>{formatarPreco(i.receita)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rel-tabela-bloco">
              <h2 className="rel-painel__titulo">Ticket médio por mesa</h2>
              <div className="rel-tabela-scroll">
                <table className="rel-tabela">
                  <thead>
                    <tr>
                      <th>Mesa</th>
                      <th>Pedidos</th>
                      <th>Ticket médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.ticketMesa.map((m) => (
                      <tr key={m.mesa}>
                        <td>Mesa {m.mesa}</td>
                        <td>{m.pedidos}</td>
                        <td>{formatarPreco(m.ticket_medio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

export default function Relatorios() {
  return (
    <AdminLayout atual="relatorios" titulo="Relatórios" docTitle="AOOBA! — Relatórios">
      <Conteudo />
    </AdminLayout>
  );
}
