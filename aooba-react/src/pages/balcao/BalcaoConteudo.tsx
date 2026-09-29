import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatarPreco, formatarHorario } from '../../lib/shared';
import { tentarEncerrarSessao } from '../../lib/contas';
import { useBeep } from '../../hooks/useBeep';
import { useContaAtiva } from '../../hooks/useContaAtiva';
import { useControleMesas } from '../../hooks/useControleMesas';
import { useConfirmarSenha } from '../../components/ConfirmarSenha';
import { useToast } from '../../components/Toast';
import { ListaItens, ResumoConta } from '../../components/ContaViews';
import { useBalcaoRealtime } from './useBalcaoRealtime';
import { carregarEstadoInicial, type EstadoBalcao, type Fechamento } from './carregamento';
import { PagamentoCard } from './PagamentoCard';
import { HistoricoModal } from './HistoricoModal';
import { ControleMesasModal } from './ControleMesasModal';
import type { Sessao } from '../../lib/types';

const ESTADO_VAZIO: EstadoBalcao = { pedidos: [], fechamentos: [], pagamentos: [], mesasAtivas: [] };
const INTERVALO_POLL_MESAS = 5000;

const TEXTO_CONEXAO = {
  online: '🟢 Online',
  conectando: '🟡 Conectando...',
  reconectando: '🟡 Reconectando...',
  offline: '🔴 Sem conexão',
} as const;

function FechamentoCard({
  fechamento,
  pendentes,
  versao,
  onFechar,
}: {
  fechamento: Fechamento;
  pendentes: number;
  versao: number;
  onFechar: () => void;
}) {
  const conta = useContaAtiva(supabase, fechamento.mesa, versao);
  const [ocupado, setOcupado] = useState(false);

  return (
    <div className="fechamento-card">
      <span className="fechamento-card__icon">⚠️</span>
      <div className="fechamento-card__mesa">MESA {fechamento.mesa} — FECHAR CONTA</div>
      <div className="fechamento-card__horario">{formatarHorario(fechamento.criado_em)}</div>
      {pendentes > 0 && <div className="fechamento-card__aviso-pendente">⚠️ Esta mesa tem {pendentes} pedido(s) ainda não entregue(s)</div>}
      {conta && (
        <>
          <ListaItens itens={conta.itens} />
          <ResumoConta conta={conta} />
          <div className="fechamento-card__total">A cobrar (saldo restante): {formatarPreco(conta.saldo_restante)}</div>
        </>
      )}
      <button
        className="btn btn--primary fechamento-card__fechar"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          await Promise.resolve(onFechar());
          setOcupado(false);
        }}
      >
        Conta Fechada
      </button>
    </div>
  );
}

function MesaAtivaCard({ sessao, versao, onFechar }: { sessao: Sessao; versao: number; onFechar: () => void }) {
  const conta = useContaAtiva(supabase, sessao.mesa, versao);
  return (
    <div className="mesa-ativa-card">
      <div className="mesa-ativa-card__mesa">Mesa {sessao.mesa}</div>
      <div className="mesa-ativa-card__horario">Aberta às {formatarHorario(sessao.aberta_em)}</div>
      {conta &&
        (conta.itens.length === 0 ? <p className="mesa-ativa-card__vazio">Nenhum pedido registrado ainda.</p> : <ListaItens itens={conta.itens} />)}
      {conta && <ResumoConta conta={conta} />}
      <button type="button" className="btn btn--secondary mesa-ativa-card__fechar" onClick={onFechar}>
        Fechar mesa
      </button>
    </div>
  );
}

export function BalcaoConteudo({ sair }: { sair: () => void }) {
  const toast = useToast();
  const beep = useBeep();
  const controle = useControleMesas(supabase);
  const { pedir: pedirSenha, modal: modalSenha } = useConfirmarSenha(supabase);

  const [estado, setEstado] = useState<EstadoBalcao>(ESTADO_VAZIO);
  const [erroCarga, setErroCarga] = useState(false);
  const [versao, setVersao] = useState(0);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [controleAberto, setControleAberto] = useState(false);
  const bump = useCallback(() => setVersao((v) => v + 1), []);

  const carregar = useCallback(async () => {
    setErroCarga(false);
    try {
      const [novo] = await Promise.all([carregarEstadoInicial(supabase), controle.carregar()]);
      setEstado(novo);
      bump();
    } catch (erro) {
      console.error('Erro ao carregar estado do balcão:', erro);
      setEstado(ESTADO_VAZIO);
      setErroCarga(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Polling de mesas (a tabela "mesas" não está no Realtime — o token é secreto).
  useEffect(() => {
    const id = window.setInterval(() => {
      controle.carregar().catch((e) => console.error('Erro no polling de mesas:', e));
    }, INTERVALO_POLL_MESAS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conexao = useBalcaoRealtime({
    cliente: supabase,
    setEstado,
    bump,
    beep: beep.tocar,
    aoSessaoEncerrada: (mesa) => controle.atualizarLocal(mesa, 'bloqueada'),
  });

  const limparMesaLocal = useCallback(
    (mesa: number | string) => {
      setEstado((e) => ({
        ...e,
        pedidos: e.pedidos.filter((p) => String(p.mesa) !== String(mesa)),
        fechamentos: e.fechamentos.filter((f) => String(f.mesa) !== String(mesa)),
        mesasAtivas: e.mesasAtivas.filter((s) => String(s.mesa) !== String(mesa)),
      }));
      bump();
      controle.atualizarLocal(mesa, 'bloqueada');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bump],
  );

  async function finalizarFechamento(f: Fechamento) {
    const pendentes = estado.pedidos.filter((p) => String(p.mesa) === String(f.mesa)).length;
    if (pendentes > 0 && !window.confirm(`Mesa ${f.mesa} tem ${pendentes} pedido(s) ainda não entregue(s). Fechar a conta mesmo assim?`)) return;
    if (await tentarEncerrarSessao(supabase, f.mesa)) limparMesaLocal(f.mesa);
  }

  async function fecharMesaDireto(mesa: number) {
    if (await tentarEncerrarSessao(supabase, mesa)) limparMesaLocal(mesa);
  }

  async function marcarEntregue(id: string) {
    const { error } = await supabase.from('pedidos').update({ status: 'entregue' }).eq('id', id);
    if (error) {
      console.error('Erro ao marcar pedido como entregue:', error);
      window.alert('Não foi possível marcar como entregue agora. Verifique sua conexão e tente de novo.');
      return;
    }
    setEstado((e) => ({ ...e, pedidos: e.pedidos.filter((p) => p.id !== id) }));
  }

  async function removerItem(pedidoId: string, itemId: number) {
    const { error } = await supabase.rpc('remover_item_pedido', { p_pedido_id: pedidoId, p_item_id: Number(itemId) });
    if (error) {
      console.error('Erro ao remover item do pedido:', error);
      window.alert(error.message || 'Não foi possível remover o item agora. Verifique sua conexão e tente de novo.');
      return;
    }
    setEstado((e) => ({
      ...e,
      pedidos: e.pedidos
        .map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.filter((i) => i.id !== itemId);
          return { ...p, itens, total: itens.reduce((s, i) => s + i.preco * i.quantidade, 0) };
        })
        .filter((p) => p.itens.length > 0),
    }));
    bump();
  }

  async function confirmarPagamento(id: string) {
    const { data, error } = await supabase.rpc('confirmar_pagamento', { p_pagamento_id: id });
    if (error) {
      console.error('Erro ao confirmar pagamento:', error);
      window.alert('Não foi possível marcar como recebido agora. Verifique sua conexão e tente de novo.');
      return;
    }
    setEstado((e) => ({ ...e, pagamentos: e.pagamentos.filter((p) => p.id !== id) }));
    const r = data as { sessao_encerrada?: boolean; mesa?: number } | null;
    if (r?.sessao_encerrada && r.mesa !== undefined) {
      limparMesaLocal(r.mesa);
      toast(`Mesa ${r.mesa} quitada e encerrada automaticamente.`);
    } else {
      bump();
    }
  }

  const mesasComSessao = new Set(estado.mesasAtivas.map((s) => String(s.mesa)));

  return (
    <div>
      <header className="header balcao-header">
        <nav className="nav container">
          <span className="nav__logo">
            AOOBA! <span className="balcao-header__tag">— Balcão</span>
          </span>
          <div className="balcao-header__acoes">
            <span className="balcao-header__conexao">{TEXTO_CONEXAO[conexao]}</span>
            <span className={`balcao-header__som-aviso${beep.avisoVisivel ? ' show' : ''}`}>Clique em "Ativar som" pra não perder os avisos de pedido</span>
            <span className="balcao-header__contador">
              Pedidos pendentes: <strong>{estado.pedidos.length}</strong>
            </span>
            <button className="btn btn--secondary balcao-header__som" aria-pressed={beep.somAtivo} onClick={() => void beep.alternar()}>
              {beep.somAtivo ? '🔊 Som ativado' : '🔔 Ativar som'}
            </button>
            <button className="btn btn--secondary balcao-header__historico" onClick={() => setHistoricoAberto(true)}>
              Histórico
            </button>
            <button className="btn btn--secondary balcao-header__historico" onClick={() => setControleAberto(true)}>
              Mesas
            </button>
            <button className="btn btn--secondary balcao-header__sair" onClick={sair}>
              Sair
            </button>
          </div>
        </nav>
      </header>

      <main className="balcao-main container">
        {erroCarga && (
          <div className="cardapio-status cardapio-status--erro">
            <p>
              Não foi possível carregar os pedidos agora. Isso NÃO significa que não há pedidos — verifique sua conexão e tente de novo antes de
              assumir que o salão está vazio.
            </p>
            <button type="button" className="btn btn--secondary" onClick={() => void carregar()}>
              Tentar novamente
            </button>
          </div>
        )}

        <div className="fechamento-grid">
          {estado.fechamentos.map((f) => (
            <FechamentoCard
              key={f.id}
              fechamento={f}
              versao={versao}
              pendentes={estado.pedidos.filter((p) => String(p.mesa) === String(f.mesa)).length}
              onFechar={() => finalizarFechamento(f)}
            />
          ))}
        </div>

        <div className="pagamento-grid">
          {estado.pagamentos.map((p) => (
            <PagamentoCard key={p.id} pagamento={p} onConfirmar={() => confirmarPagamento(p.id)} />
          ))}
        </div>

        <h2 className="balcao-secao-titulo">Fila de Pedidos</h2>
        {!erroCarga && estado.pedidos.length === 0 && <p className="balcao-vazio">Nenhum pedido pendente no momento.</p>}
        <div className="balcao-grid">
          {estado.pedidos.map((pedido) => (
            <div className="pedido-card" key={pedido.id}>
              <div>
                <div className="pedido-card__mesa">Mesa {pedido.mesa}</div>
                {pedido.cliente_nome && <div className="pedido-card__cliente">{pedido.cliente_nome}</div>}
                <div className="pedido-card__horario">{formatarHorario(pedido.criado_em)}</div>
              </div>
              <ul className="pedido-card__itens">
                {pedido.itens.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.quantidade}x {item.nome}
                    </span>
                    <span className="pedido-card__item-fim">
                      {formatarPreco(item.preco * item.quantidade)}
                      <button
                        type="button"
                        className="pedido-card__item-remover"
                        aria-label={`Remover ${item.nome}`}
                        title="Remover item (pedido errado)"
                        onClick={() => pedirSenha(() => removerItem(pedido.id, item.id))}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="pedido-card__total">Total: {formatarPreco(pedido.total)}</div>
              <button className="btn btn--primary pedido-card__entregar" onClick={() => void marcarEntregue(pedido.id)}>
                Entregue
              </button>
            </div>
          ))}
        </div>

        <h2 className="balcao-secao-titulo">Mesas Ativas</h2>
        {estado.mesasAtivas.length === 0 && <p className="balcao-vazio">Nenhuma mesa ocupada no momento.</p>}
        <div className="mesas-ativas-grid">
          {estado.mesasAtivas.map((s) => (
            <MesaAtivaCard key={s.id} sessao={s} versao={versao} onFechar={() => pedirSenha(() => fecharMesaDireto(s.mesa))} />
          ))}
        </div>
      </main>

      <HistoricoModal aberto={historicoAberto} onFechar={() => setHistoricoAberto(false)} />
      <ControleMesasModal aberto={controleAberto} onFechar={() => setControleAberto(false)} controle={controle} mesasComSessao={mesasComSessao} />
      {modalSenha}
    </div>
  );
}
