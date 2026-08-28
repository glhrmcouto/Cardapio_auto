// ========================================
// RELATÓRIOS — painel de vendas (leitura)
// ========================================
//
// Exige as mesmas duas coisas que admin.html: sessão autenticada
// (Supabase Auth) E papel "admin" na tabela "perfis" (ver
// supabase/003_admin.sql). Login sem o papel certo é barrado e deslogado.
// Os dados vêm das funções RPC de supabase/004_relatorios.sql, que já
// fazem essa mesma checagem de novo no banco — a checagem daqui só evita
// mostrar a tela vazia por um instante pra quem não pode ver nada.

import { supabase } from './supabaseClient.js';
import { formatarPreco, escaparTexto, formatarDataISO } from './shared.js';

const loginTela = document.getElementById('loginTela');
const loginForm = document.getElementById('loginForm');
const loginEmailEl = document.getElementById('loginEmail');
const loginSenhaEl = document.getElementById('loginSenha');
const loginErroEl = document.getElementById('loginErro');
const loginEntrarBtn = document.getElementById('loginEntrarBtn');

const relatoriosPagina = document.getElementById('relatoriosPagina');
const sairBtn = document.getElementById('sairBtn');

const relatorioCarregandoEl = document.getElementById('relatorioCarregando');
const relatorioErroEl = document.getElementById('relatorioErro');
const relatorioTentarBtn = document.getElementById('relatorioTentar');
const relatorioVazioEl = document.getElementById('relatorioVazio');
const relatorioConteudoEl = document.getElementById('relatorioConteudo');

const periodoInicioEl = document.getElementById('periodoInicio');
const periodoFimEl = document.getElementById('periodoFim');
const periodoCustomForm = document.getElementById('periodoCustomForm');
const botoesAtalho = document.querySelectorAll('.rel-periodo__btn');

const cardFaturamentoEl = document.getElementById('cardFaturamento');
const cardPedidosEl = document.getElementById('cardPedidos');
const cardTicketMedioEl = document.getElementById('cardTicketMedio');
const cardItemCampeaoEl = document.getElementById('cardItemCampeao');

const picoHorarioEl = document.getElementById('picoHorario');
const exportarCsvBtn = document.getElementById('exportarCsvBtn');

const backupBtn = document.getElementById('backupBtn');

const LABEL_CATEGORIA = {
  drink: 'Drinks',
  cerveja: 'Cervejas',
  sem_alcool: 'Sem Álcool',
  narguile: 'Narguilé',
  essencia: 'Essências',
};
const ORDEM_CATEGORIAS = ['drink', 'cerveja', 'sem_alcool', 'narguile', 'essencia'];

// Paleta categórica validada (CVD-safe) pra 5 séries num surface escuro
// (#161616) — ver skill de dataviz. A ordem importa: é o que garante a
// separação entre cores vizinhas, inclusive a última com a primeira (a
// rosca fecha em círculo).
const CORES_CATEGORIA = {
  drink: '#3987e5',
  cerveja: '#d95926',
  sem_alcool: '#199e70',
  narguile: '#c98500',
  essencia: '#d55181',
};

// ========================================
// LOGIN / LOGOUT (com checagem de papel admin)
// ========================================

function mostrarTelaLogin(mensagemErro) {
  relatoriosPagina.style.display = 'none';
  loginTela.style.display = 'flex';
  loginEmailEl.value = '';
  loginSenhaEl.value = '';

  if (mensagemErro) {
    loginErroEl.textContent = mensagemErro;
    loginErroEl.style.display = 'block';
  } else {
    loginErroEl.style.display = 'none';
  }
}

let paginaIniciada = false;

function mostrarPagina() {
  loginTela.style.display = 'none';
  relatoriosPagina.style.display = '';

  if (paginaIniciada) return;
  paginaIniciada = true;

  ativarAtalho('7dias');
}

async function verificarAdminEExibir(session) {
  if (!session) {
    mostrarTelaLogin();
    return;
  }

  const { data: perfil, error } = await supabase
    .from('perfis')
    .select('papel')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Erro ao verificar permissão de admin:', error);
    mostrarTelaLogin('Não foi possível verificar sua permissão agora. Tente de novo.');
    await supabase.auth.signOut();
    return;
  }

  if (!perfil || perfil.papel !== 'admin') {
    mostrarTelaLogin('Este usuário não tem permissão de administrador.');
    await supabase.auth.signOut();
    return;
  }

  mostrarPagina();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginEntrarBtn.disabled = true;
  loginEntrarBtn.textContent = 'Entrando...';
  loginErroEl.style.display = 'none';

  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmailEl.value.trim(),
    password: loginSenhaEl.value,
  });

  loginEntrarBtn.disabled = false;
  loginEntrarBtn.textContent = 'Entrar';

  if (error) {
    loginErroEl.textContent = 'E-mail ou senha inválidos.';
    loginErroEl.style.display = 'block';
    return;
  }

  await verificarAdminEExibir(data.session);
});

sairBtn.addEventListener('click', () => {
  supabase.auth.signOut();
});

// ========================================
// SELETOR DE PERÍODO
// ========================================

function calcularAtalho(tipo) {
  const hoje = new Date();
  const fim = new Date(hoje);
  let inicio = new Date(hoje);

  if (tipo === '7dias') {
    inicio.setDate(inicio.getDate() - 6);
  } else if (tipo === '30dias') {
    inicio.setDate(inicio.getDate() - 29);
  } else if (tipo === 'mes') {
    inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  }
  // 'hoje' não mexe em inicio/fim — ambos já são a data de hoje

  return { inicio: formatarDataISO(inicio), fim: formatarDataISO(fim) };
}

let periodoAtual = { inicio: null, fim: null };

function ativarAtalho(tipo) {
  botoesAtalho.forEach(botao => {
    botao.classList.toggle('rel-periodo__btn--ativo', botao.dataset.atalho === tipo);
  });
  const { inicio, fim } = calcularAtalho(tipo);
  periodoInicioEl.value = inicio;
  periodoFimEl.value = fim;
  periodoAtual = { inicio, fim };
  carregarRelatorio();
}

botoesAtalho.forEach(botao => {
  botao.addEventListener('click', () => ativarAtalho(botao.dataset.atalho));
});

periodoCustomForm.addEventListener('submit', (event) => {
  event.preventDefault();
  botoesAtalho.forEach(botao => botao.classList.remove('rel-periodo__btn--ativo'));

  let inicio = periodoInicioEl.value;
  let fim = periodoFimEl.value;
  if (!inicio || !fim) return;

  // Datas em formato ISO (YYYY-MM-DD) comparam certo como texto
  if (inicio > fim) {
    [inicio, fim] = [fim, inicio];
    periodoInicioEl.value = inicio;
    periodoFimEl.value = fim;
  }

  periodoAtual = { inicio, fim };
  carregarRelatorio();
});

// ========================================
// CARREGAMENTO DO RELATÓRIO (5 RPCs em paralelo)
// ========================================

let maisVendidosAtual = [];
let ordenacaoAtual = { campo: 'quantidade', direcao: 'desc' };

let graficoFaturamento;
let graficoCategoria;
let graficoHora;

async function carregarRelatorio() {
  if (!periodoAtual.inicio || !periodoAtual.fim) return;

  relatorioCarregandoEl.style.display = 'block';
  relatorioErroEl.style.display = 'none';
  relatorioVazioEl.style.display = 'none';
  relatorioConteudoEl.style.display = 'none';

  try {
    const params = { p_data_inicio: periodoAtual.inicio, p_data_fim: periodoAtual.fim };

    const [
      { data: porDia, error: e1 },
      { data: maisVendidos, error: e2 },
      { data: ticketMesa, error: e3 },
      { data: porCategoria, error: e4 },
      { data: porHora, error: e5 },
    ] = await Promise.all([
      supabase.rpc('faturamento_por_dia', params),
      supabase.rpc('produtos_mais_vendidos', { ...params, p_limite: 100 }),
      supabase.rpc('ticket_medio_por_mesa', params),
      supabase.rpc('vendas_por_categoria', params),
      supabase.rpc('movimento_por_hora', params),
    ]);

    const erro = e1 || e2 || e3 || e4 || e5;
    if (erro) throw erro;

    relatorioCarregandoEl.style.display = 'none';

    const numeroPedidos = ticketMesa.reduce((acc, m) => acc + Number(m.pedidos), 0);

    if (numeroPedidos === 0) {
      relatorioVazioEl.style.display = 'block';
      exportarCsvBtn.disabled = true;
      return;
    }

    const faturamentoTotal = porDia.reduce((acc, d) => acc + Number(d.faturamento), 0);
    const ticketMedioGeral = faturamentoTotal / numeroPedidos;

    cardFaturamentoEl.textContent = formatarPreco(faturamentoTotal);
    cardPedidosEl.textContent = numeroPedidos.toLocaleString('pt-BR');
    cardTicketMedioEl.textContent = formatarPreco(ticketMedioGeral);
    cardItemCampeaoEl.textContent = maisVendidos.length > 0 ? maisVendidos[0].nome : '—';

    maisVendidosAtual = maisVendidos;
    renderizarTabelaMaisVendidos();
    renderizarTabelaTicketMesa(ticketMesa);
    renderizarGraficoFaturamento(porDia);
    renderizarGraficoCategoria(porCategoria);
    renderizarGraficoHora(porHora);

    exportarCsvBtn.disabled = false;
    relatorioConteudoEl.style.display = '';
  } catch (erro) {
    console.error('Erro ao carregar relatório:', erro);
    relatorioCarregandoEl.style.display = 'none';
    relatorioErroEl.style.display = 'block';
  }
}

relatorioTentarBtn.addEventListener('click', carregarRelatorio);

// ========================================
// TABELA: MAIS VENDIDOS (ordenável)
// ========================================

function ordenarMaisVendidos() {
  const { campo, direcao } = ordenacaoAtual;
  const multiplicador = direcao === 'asc' ? 1 : -1;

  return [...maisVendidosAtual].sort((a, b) => {
    if (campo === 'nome') return a.nome.localeCompare(b.nome) * multiplicador;
    return (Number(a[campo]) - Number(b[campo])) * multiplicador;
  });
}

function renderizarTabelaMaisVendidos() {
  const tbody = document.querySelector('#tabelaMaisVendidos tbody');
  const linhas = ordenarMaisVendidos();

  tbody.innerHTML = linhas.map(item => `
    <tr>
      <td>${escaparTexto(item.nome)}</td>
      <td>${item.quantidade}</td>
      <td>${formatarPreco(item.receita)}</td>
    </tr>
  `).join('');

  document.querySelectorAll('#tabelaMaisVendidos th[data-ordenar]').forEach(th => {
    const ativo = th.dataset.ordenar === ordenacaoAtual.campo;
    th.classList.toggle('rel-tabela__th--ativo', ativo);
    if (ativo) {
      th.dataset.direcao = ordenacaoAtual.direcao;
    } else {
      delete th.dataset.direcao;
    }
  });
}

document.querySelectorAll('#tabelaMaisVendidos th[data-ordenar]').forEach(th => {
  th.addEventListener('click', () => {
    const campo = th.dataset.ordenar;
    if (ordenacaoAtual.campo === campo) {
      ordenacaoAtual.direcao = ordenacaoAtual.direcao === 'asc' ? 'desc' : 'asc';
    } else {
      ordenacaoAtual = { campo, direcao: campo === 'nome' ? 'asc' : 'desc' };
    }
    renderizarTabelaMaisVendidos();
  });
});

// ========================================
// TABELA: TICKET MÉDIO POR MESA
// ========================================

function renderizarTabelaTicketMesa(ticketMesa) {
  const tbody = document.querySelector('#tabelaTicketMesa tbody');
  tbody.innerHTML = ticketMesa.map(m => `
    <tr>
      <td>Mesa ${m.mesa}</td>
      <td>${m.pedidos}</td>
      <td>${formatarPreco(m.ticket_medio)}</td>
    </tr>
  `).join('');
}

// ========================================
// EXPORTAR CSV (mais vendidos, na ordenação atual)
// ========================================

exportarCsvBtn.addEventListener('click', () => {
  const linhas = ordenarMaisVendidos();
  if (linhas.length === 0) return;

  const cabecalho = 'Produto;Quantidade;Receita (R$)';
  const corpo = linhas.map(item => {
    const nome = String(item.nome).replace(/"/g, '""');
    const receita = Number(item.receita).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `"${nome}";${item.quantidade};"${receita}"`;
  }).join('\r\n');

  // BOM UTF-8 no início pra acentos abrirem certo no Excel
  const csv = '﻿' + cabecalho + '\r\n' + corpo;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `relatorio-mais-vendidos_${periodoAtual.inicio}_a_${periodoAtual.fim}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

// ========================================
// BACKUP COMPLETO (produtos + pedidos + pedido_itens, sempre tudo — não
// depende do período selecionado na tela)
// ========================================
//
// Isso NÃO substitui um backup de verdade do banco (esse é o papel do
// GitHub Action em .github/workflows/backup.yml, que faz um pg_dump
// completo do schema todo via cron): é um jeito rápido do dono baixar os
// dados na hora, direto do navegador, sem precisar mexer no Supabase.
//
// produtos/pedidos/pedido_itens são lidos direto das tabelas (não via RPC)
// porque o admin já tem policy de SELECT nelas (produtos: só admin, ver
// 003_admin.sql; pedidos/pedido_itens: qualquer authenticated, ver
// 001_schema.sql) — não precisa de função nova só pra isso.
//
// DUAS CÓPIAS, DOIS PROPÓSITOS:
//   - backup.json: os dados CRUS, exatamente como estão no banco (todas as
//     colunas, ids, uuids) — é a fonte da verdade caso precise restaurar
//     ou script algo em cima.
//   - os .csv: uma versão LEGÍVEL pra abrir no Excel/Sheets — cabeçalho em
//     português, datas no fuso de SP, preço já formatado, e pedido_itens.csv
//     já vem com mesa/status/data do pedido embutidos (evita ter que ficar
//     cruzando manualmente com pedidos.csv pela pedido_id).

const TAMANHO_PAGINA_BACKUP = 1000; // limite padrão de linhas por resposta do PostgREST

// O PostgREST nunca devolve mais que ~1000 linhas de uma vez só, então pra
// pegar a tabela INTEIRA (não só as 1000 primeiras) é preciso paginar com
// .range() até uma página vir mais curta que o tamanho pedido.
async function buscarTabelaCompleta(nomeTabela, colunaOrdenacao) {
  let registros = [];
  let pagina = 0;

  while (true) {
    const inicio = pagina * TAMANHO_PAGINA_BACKUP;
    const fim = inicio + TAMANHO_PAGINA_BACKUP - 1;

    const { data, error } = await supabase
      .from(nomeTabela)
      .select('*')
      .order(colunaOrdenacao)
      .range(inicio, fim);

    if (error) throw error;

    registros = registros.concat(data);
    if (data.length < TAMANHO_PAGINA_BACKUP) break;
    pagina++;
  }

  return registros;
}

const TIPO_PEDIDO_LABEL = { pedido: 'Pedido', fechar_conta: 'Fechar conta' };
const STATUS_PEDIDO_LABEL = { pendente: 'Pendente', entregue: 'Entregue', finalizado: 'Finalizado' };
const ORIGEM_PEDIDO_LABEL = { cliente: 'Cliente (QR code)', garcom: 'Garçom' };

// dd/mm/aaaa hh:mm no fuso de SP — mesmo raciocínio das RPCs de relatório
// (supabase/004_relatorios.sql): "hoje"/horário tem que bater com o
// relógio de parede do bar, não com UTC.
function formatarDataHoraCsv(iso) {
  if (!iso) return '';
  // toLocaleString bota uma vírgula entre data e hora por padrão
  // ("27/08/2026, 18:10") — tirada aqui só por estética.
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', '');
}

function formatarBooleanoCsv(valor) {
  if (valor === null || valor === undefined) return '';
  return valor ? 'Sim' : 'Não';
}

// Cabeçalho em português, preço já em "R$ 0,00", ativo como Sim/Não.
function linhasProdutosCsv(produtos) {
  return produtos.map(p => ({
    'ID': p.id,
    'Nome': p.nome,
    'Descrição': p.descricao,
    'Preço': formatarPreco(p.preco),
    'Categoria': LABEL_CATEGORIA[p.categoria] || p.categoria,
    'Ativo': formatarBooleanoCsv(p.ativo),
    'Ordem': p.ordem,
  }));
}

// Sem cliente_id/sessao_id (uuid técnico, não ajuda a leitura humana) —
// quem precisar disso ao pé da letra usa o backup.json.
function linhasPedidosCsv(pedidos) {
  return pedidos.map(p => ({
    'ID': p.id,
    'Tipo': TIPO_PEDIDO_LABEL[p.tipo] || p.tipo,
    'Mesa': p.mesa,
    'Cliente': p.cliente_nome || '',
    'Total': formatarPreco(p.total),
    'Status': STATUS_PEDIDO_LABEL[p.status] || p.status,
    'Origem': ORIGEM_PEDIDO_LABEL[p.origem] || p.origem || '',
    'Data/Hora': formatarDataHoraCsv(p.criado_em),
  }));
}

// Junta mesa/status/data do PEDIDO em cada linha de item — sem isso, uma
// planilha de itens com só "pedido_id" cru força a ficar cruzando com
// pedidos.csv manualmente pra saber de qual mesa/dia é cada item.
function linhasPedidoItensCsv(pedidoItens, pedidos) {
  const pedidosPorId = new Map(pedidos.map(p => [p.id, p]));

  return pedidoItens.map(item => {
    const pedido = pedidosPorId.get(item.pedido_id);
    return {
      'ID Item': item.id,
      'ID Pedido': item.pedido_id,
      'Mesa': pedido ? pedido.mesa : '',
      'Data/Hora do Pedido': pedido ? formatarDataHoraCsv(pedido.criado_em) : '',
      'Status do Pedido': pedido ? (STATUS_PEDIDO_LABEL[pedido.status] || pedido.status) : '',
      'Produto': item.nome_snapshot,
      'Preço Unitário': formatarPreco(item.preco_unitario),
      'Quantidade': item.quantidade,
      'Subtotal': formatarPreco(item.preco_unitario * item.quantidade),
      'Compartilhado': formatarBooleanoCsv(item.compartilhado),
    };
  });
}

// Colunas de reserva pra quando a tabela vier vazia (aí não dá pra descobrir
// as colunas olhando a primeira linha, porque ela não existe).
const COLUNAS_CSV_VAZIO = {
  produtos: ['ID', 'Nome', 'Descrição', 'Preço', 'Categoria', 'Ativo', 'Ordem'],
  pedidos: ['ID', 'Tipo', 'Mesa', 'Cliente', 'Total', 'Status', 'Origem', 'Data/Hora'],
  pedido_itens: ['ID Item', 'ID Pedido', 'Mesa', 'Data/Hora do Pedido', 'Status do Pedido', 'Produto', 'Preço Unitário', 'Quantidade', 'Subtotal', 'Compartilhado'],
};

function escaparCampoCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
  return /[;",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// Separador ";" (não ","), mesmo motivo do CSV de "mais vendidos" logo
// acima: no Excel em pt-BR, "," é o separador decimal — um CSV separado por
// vírgula não abre em colunas certas nessa configuração regional. BOM UTF-8
// (﻿) no início pros acentos abrirem certo — ATENÇÃO: precisa ser
// exatamente esse escape (﻿), nunca um caractere "invisível" digitado
// direto no código-fonte — foi isso que se perdeu silenciosamente antes
// (o literal virou uma string vazia sem ninguém perceber, e os CSVs saíam
// sem BOM nenhum, dando os acentos quebrados tipo "TÃ´nica").
function paraCsvLegivel(linhas, nomeTabela) {
  const colunas = linhas.length > 0 ? Object.keys(linhas[0]) : COLUNAS_CSV_VAZIO[nomeTabela];
  const cabecalho = colunas.join(';');
  const corpo = linhas.map(linha => colunas.map(coluna => escaparCampoCsv(linha[coluna])).join(';')).join('\r\n');
  return '﻿' + cabecalho + (corpo ? '\r\n' + corpo : '');
}

async function baixarBackupCompleto() {
  backupBtn.disabled = true;
  backupBtn.textContent = 'Gerando backup...';

  try {
    const [produtos, pedidos, pedidoItens] = await Promise.all([
      buscarTabelaCompleta('produtos', 'id'),
      buscarTabelaCompleta('pedidos', 'id'),
      buscarTabelaCompleta('pedido_itens', 'id'),
    ]);

    const geradoEm = new Date().toISOString();
    const zip = new JSZip();

    zip.file('backup.json', JSON.stringify({ gerado_em: geradoEm, produtos, pedidos, pedido_itens: pedidoItens }, null, 2));
    zip.file('produtos.csv', paraCsvLegivel(linhasProdutosCsv(produtos), 'produtos'));
    zip.file('pedidos.csv', paraCsvLegivel(linhasPedidosCsv(pedidos), 'pedidos'));
    zip.file('pedido_itens.csv', paraCsvLegivel(linhasPedidoItensCsv(pedidoItens, pedidos), 'pedido_itens'));

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-aooba_${formatarDataISO(new Date())}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (erro) {
    console.error('Erro ao gerar backup:', erro);
    alert('Não foi possível gerar o backup agora. Verifique sua conexão e tente de novo.');
  } finally {
    backupBtn.disabled = false;
    backupBtn.textContent = 'Baixar backup completo';
  }
}

backupBtn.addEventListener('click', baixarBackupCompleto);

// ========================================
// GRÁFICOS (Chart.js, cores da marca — ver style.css)
// ========================================

const COR_TEXTO_SECUNDARIO = '#c9c9c9';
const COR_GRADE = 'rgba(255, 255, 255, 0.06)';
const COR_TOOLTIP_FUNDO = '#161616';
const COR_TOOLTIP_BORDA = 'rgba(255, 255, 255, 0.15)';

function formatarDataCurta(isoDate) {
  const [, mes, dia] = isoDate.split('-');
  return `${dia}/${mes}`;
}

function renderizarGraficoFaturamento(porDia) {
  const ctx = document.getElementById('graficoFaturamento');
  const labels = porDia.map(d => formatarDataCurta(d.dia));
  const valores = porDia.map(d => Number(d.faturamento));

  if (graficoFaturamento) graficoFaturamento.destroy();
  graficoFaturamento = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Faturamento',
        data: valores,
        borderColor: '#FF7A1A',
        backgroundColor: 'rgba(255, 122, 26, 0.1)',
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 5,
        pointBackgroundColor: '#FF7A1A',
        pointBorderColor: COR_TOOLTIP_FUNDO,
        pointBorderWidth: 2,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: COR_TOOLTIP_FUNDO,
          borderColor: COR_TOOLTIP_BORDA,
          borderWidth: 1,
          titleColor: '#FFFFFF',
          bodyColor: COR_TEXTO_SECUNDARIO,
          padding: 10,
          callbacks: {
            label: (item) => ` ${formatarPreco(item.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: COR_TEXTO_SECUNDARIO },
          grid: { color: COR_GRADE },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: COR_TEXTO_SECUNDARIO,
            callback: (valor) => formatarPreco(valor),
          },
          grid: { color: COR_GRADE },
        },
      },
    },
  });
}

function renderizarGraficoCategoria(porCategoria) {
  const ctx = document.getElementById('graficoCategoria');

  const presentes = ORDEM_CATEGORIAS
    .map(categoria => porCategoria.find(c => c.categoria === categoria))
    .filter(Boolean);

  const labels = presentes.map(c => LABEL_CATEGORIA[c.categoria] || c.categoria);
  const valores = presentes.map(c => Number(c.receita));
  const cores = presentes.map(c => CORES_CATEGORIA[c.categoria] || '#8a8a8a');

  if (graficoCategoria) graficoCategoria.destroy();
  graficoCategoria = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: cores,
        borderColor: COR_TOOLTIP_FUNDO,
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: COR_TEXTO_SECUNDARIO, usePointStyle: true, boxWidth: 8, padding: 14 },
        },
        tooltip: {
          backgroundColor: COR_TOOLTIP_FUNDO,
          borderColor: COR_TOOLTIP_BORDA,
          borderWidth: 1,
          titleColor: '#FFFFFF',
          bodyColor: COR_TEXTO_SECUNDARIO,
          padding: 10,
          callbacks: {
            label: (item) => ` ${item.label}: ${formatarPreco(item.parsed)}`,
          },
        },
      },
    },
  });
}

function renderizarGraficoHora(porHora) {
  const ctx = document.getElementById('graficoHora');
  const labels = porHora.map(h => `${String(h.hora).padStart(2, '0')}h`);
  const valores = porHora.map(h => Number(h.pedidos));

  const picoIndice = valores.reduce((melhorIdx, v, i) => (v > valores[melhorIdx] ? i : melhorIdx), 0);
  picoHorarioEl.textContent = valores[picoIndice] > 0 ? `Pico às ${labels[picoIndice]}` : '';

  if (graficoHora) graficoHora.destroy();
  graficoHora = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pedidos',
        data: valores,
        backgroundColor: '#F5772E',
        borderRadius: 4,
        maxBarThickness: 24,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: COR_TOOLTIP_FUNDO,
          borderColor: COR_TOOLTIP_BORDA,
          borderWidth: 1,
          titleColor: '#FFFFFF',
          bodyColor: COR_TEXTO_SECUNDARIO,
          padding: 10,
          callbacks: {
            label: (item) => ` ${item.parsed.y} pedido(s)`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: COR_TEXTO_SECUNDARIO },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: COR_TEXTO_SECUNDARIO, precision: 0 },
          grid: { color: COR_GRADE },
        },
      },
    },
  });
}

// ========================================
// BOOTSTRAP (fica por último de propósito)
// ========================================
//
// verificarAdminEExibir(), disparada pela checagem inicial de sessão logo
// abaixo, chama mostrarPagina() -> ativarAtalho() de forma síncrona (sem
// nenhum "await" no meio). Se esse bootstrap ficasse ANTES das
// declarações de estado (ex.: "let periodoAtual" lá em cima), a chamada
// síncrona chegaria em "periodoAtual = ..." antes da própria declaração
// ter rodado — o "await" no topo do módulo só suspende a CONTINUAÇÃO do
// próprio módulo, então tudo que vem depois dele (as declarações
// seguintes) só existe de fato depois que essa promise resolve. Por isso
// esse bloco só roda depois que toda declaração do arquivo já aconteceu.

supabase.auth.onAuthStateChange((_evento, session) => {
  if (!session) {
    paginaIniciada = false;
    mostrarTelaLogin();
  }
});

const { data: { session: sessaoInicial } } = await supabase.auth.getSession();
await verificarAdminEExibir(sessaoInicial);
