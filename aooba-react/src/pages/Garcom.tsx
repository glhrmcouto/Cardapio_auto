import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '../auth/RequireAuth';
import { useToast } from '../components/Toast';
import { useControleMesas } from '../hooks/useControleMesas';
import { supabaseGarcom as supabase } from '../lib/supabase';
import { formatarHorario, formatarPreco } from '../lib/shared';
import { ListaItens } from '../components/ContaViews';
import { NovoPedidoModal } from './garcom/NovoPedidoModal';
import { ContaMesaModal } from './garcom/ContaMesaModal';
import type { Papel, Pedido, PedidoComItens, PedidoItem, Sessao } from '../lib/types';
import '../styles/balcao.css';
import '../styles/garcom.css';

const INTERVALO_POLL_MESAS = 5000;
type Aba = 'mesas' | 'pedidos';

const porCriacao = (a: PedidoComItens, b: PedidoComItens) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime();

function GarcomConteudo({ papel, sair }: { papel: Papel | null; sair: () => void }) {
  const toast = useToast();
  const controle = useControleMesas(supabase);
  const [aba, setAba] = useState<Aba>('mesas');
  const [sessoes, setSessoes] = useState<Pick<Sessao, 'id' | 'mesa'>[]>([]);
  const [pedidos, setPedidos] = useState<PedidoComItens[]>([]);
  const [mesasCarregando, setMesasCarregando] = useState(true);
  const [mesasErro, setMesasErro] = useState(false);
  const [pedidosCarregando, setPedidosCarregando] = useState(true);
  const [pedidosErro, setPedidosErro] = useState(false);
  const [novoPedidoMesa, setNovoPedidoMesa] = useState<number | null>(null);
  const [contaMesa, setContaMesa] = useState<number | null>(null);

  const carregarSessoes = useCallback(async () => {
    const { data, error } = await supabase.from('sessoes').select('id, mesa').eq('status', 'aberta');
    if (error) throw error;
    setSessoes(data as Pick<Sessao, 'id' | 'mesa'>[]);
  }, []);

  const carregarMesas = useCallback(async () => {
    setMesasCarregando(true);
    setMesasErro(false);
    try {
      await Promise.all([controle.carregar(), carregarSessoes()]);
    } catch (erro) {
      console.error('Erro ao carregar mesas:', erro);
      setMesasErro(true);
    }
    setMesasCarregando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregarPedidos = useCallback(async () => {
    setPedidosCarregando(true);
    setPedidosErro(false);
    const { data, error } = await supabase
      .from('pedidos')
      .select('id, mesa, total, status, criado_em, cliente_nome, itens:pedido_itens(id, nome:nome_snapshot, preco:preco_unitario, quantidade)')
      .eq('tipo', 'pedido')
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true });
    if (error) {
      console.error('Erro ao carregar pedidos:', error);
      setPedidosErro(true);
    } else {
      setPedidos(data as unknown as PedidoComItens[]);
    }
    setPedidosCarregando(false);
  }, []);

  useEffect(() => {
    void carregarMesas();
    void carregarPedidos();
  }, [carregarMesas, carregarPedidos]);

  // Realtime de sessões e pedidos.
  useEffect(() => {
    const canal = supabase
      .channel('garcom-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessoes' }, (p) => {
        const nova = p.new as Sessao;
        if (nova.status !== 'aberta') return;
        setSessoes((l) => (l.some((s) => s.id === nova.id) ? l : [...l, nova]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes' }, (p) => {
        const atual = p.new as Sessao;
        if (atual.status === 'aberta') return;
        setSessoes((l) => l.filter((s) => s.id !== atual.id));
        controle.atualizarLocal(atual.mesa, 'bloqueada');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, async (p) => {
        const novo = p.new as Pedido;
        if (novo.tipo !== 'pedido' || novo.status !== 'pendente') return;
        const { data, error } = await supabase.from('pedido_itens').select('id, nome:nome_snapshot, preco:preco_unitario, quantidade').eq('pedido_id', novo.id);
        setPedidos((l) => [...l, { ...novo, itens: error ? [] : (data as PedidoItem[]) }].sort(porCriacao));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, (p) => {
        const atual = p.new as Pedido;
        if (atual.tipo === 'pedido' && atual.status !== 'pendente') setPedidos((l) => l.filter((x) => x.id !== atual.id));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling: "mesas" não está no Realtime (token secreto).
  useEffect(() => {
    const id = window.setInterval(() => {
      Promise.all([controle.carregar(), carregarSessoes()]).catch((e) => console.error('Erro no polling de mesas:', e));
    }, INTERVALO_POLL_MESAS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function marcarEntregue(id: string) {
    const { error } = await supabase.from('pedidos').update({ status: 'entregue' }).eq('id', id);
    if (error) {
      console.error('Erro ao marcar pedido como entregue:', error);
      window.alert('Não foi possível marcar como entregue agora. Verifique sua conexão e tente de novo.');
      return;
    }
    setPedidos((l) => l.filter((p) => p.id !== id));
  }

  const mesasComSessao = new Set(sessoes.map((s) => String(s.mesa)));
  const { mesas, ocupado } = controle;

  async function novoPedido(mesaNumero: number) {
    const mesa = mesas.find((m) => m.numero === mesaNumero);
    if (!mesa) return;
    if (mesa.status_mesa === 'bloqueada') {
      if (!window.confirm(`Mesa ${mesaNumero} está bloqueada. Liberar e continuar com o pedido?`)) return;
      const { error } = await supabase.rpc('liberar_mesa', { p_mesa: mesaNumero });
      if (error) {
        console.error('Erro ao liberar mesa antes do pedido:', error);
        window.alert('Não foi possível liberar a mesa agora. Tente de novo.');
        return;
      }
      controle.atualizarLocal(mesaNumero, 'liberada');
    }
    setNovoPedidoMesa(mesaNumero);
  }

  return (
    <div>
      <header className="header garcom-header">
        <nav className="nav container garcom-header__nav">
          <span className="nav__logo">
            AOOBA! <span className="garcom-header__tag">— Garçom</span>
          </span>
          <button className="btn btn--secondary garcom-header__sair" onClick={sair}>
            Sair
          </button>
        </nav>
      </header>

      <main className="garcom-main">
        <section className="garcom-aba" hidden={aba !== 'mesas'}>
          <div className="controle-mesas-massa">
            <button type="button" className="btn btn--secondary" disabled={ocupado === 'liberar-todas'} onClick={() => void controle.liberarTodas()}>
              Liberar todas
            </button>
            <button type="button" className="btn btn--secondary" disabled={ocupado === 'bloquear-todas'} onClick={() => void controle.bloquearTodas()}>
              Bloquear todas
            </button>
          </div>

          {mesasCarregando && <p className="cardapio-status">Carregando mesas...</p>}
          {mesasErro && (
            <div className="cardapio-status cardapio-status--erro">
              <p>Não foi possível carregar as mesas agora. Verifique sua conexão e tente de novo.</p>
              <button type="button" className="btn btn--secondary" onClick={() => void carregarMesas()}>
                Tentar novamente
              </button>
            </div>
          )}
          {!mesasCarregando && !mesasErro && mesas.length === 0 && <p className="modal-panel__vazio">Nenhuma mesa cadastrada.</p>}

          <div className="controle-mesas-grid">
            {mesas.map((mesa) => {
              if (!mesa.ativa) {
                return (
                  <div key={mesa.numero} className="controle-mesa-card controle-mesa-card--inativa">
                    <div className="controle-mesa-card__mesa">Mesa {mesa.numero}</div>
                    <span className="controle-mesa-card__status controle-mesa-card__status--inativa">Inativa</span>
                    <button type="button" className="btn btn--secondary controle-mesa-card__ativar" disabled={ocupado === `ativar-${mesa.numero}`} onClick={() => void controle.ativar(mesa.numero)}>
                      Ativar mesa
                    </button>
                  </div>
                );
              }
              const bloqueada = mesa.status_mesa === 'bloqueada';
              const temSessao = mesasComSessao.has(String(mesa.numero));
              return (
                <div key={mesa.numero} className={`controle-mesa-card${bloqueada ? ' controle-mesa-card--bloqueada' : ''}`}>
                  <div className="controle-mesa-card__mesa">Mesa {mesa.numero}</div>
                  <span className={`controle-mesa-card__status controle-mesa-card__status--${mesa.status_mesa}`}>{bloqueada ? 'Bloqueada' : 'Liberada'}</span>
                  {temSessao && <span className="controle-mesa-card__sessao">Sessão aberta</span>}
                  {papel === 'garcom' && (
                    <button type="button" className="btn btn--primary controle-mesa-card__novo-pedido" onClick={() => void novoPedido(mesa.numero)}>
                      Novo pedido
                    </button>
                  )}
                  {temSessao && (
                    <button type="button" className="btn btn--secondary controle-mesa-card__ver-conta" onClick={() => setContaMesa(mesa.numero)}>
                      Ver conta
                    </button>
                  )}
                  {bloqueada && (
                    <button type="button" className="btn btn--secondary controle-mesa-card__liberar" disabled={ocupado === `liberar-${mesa.numero}`} onClick={() => void controle.liberar(mesa.numero)}>
                      Liberar mesa
                    </button>
                  )}
                  <button type="button" className="btn btn--secondary controle-mesa-card__desativar" disabled={ocupado === `desativar-${mesa.numero}`} onClick={() => void controle.desativar(mesa.numero)}>
                    Desativar mesa
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="garcom-aba" hidden={aba !== 'pedidos'}>
          {pedidosCarregando && <p className="cardapio-status">Carregando pedidos...</p>}
          {pedidosErro && (
            <div className="cardapio-status cardapio-status--erro">
              <p>Não foi possível carregar os pedidos agora. Verifique sua conexão e tente de novo.</p>
              <button type="button" className="btn btn--secondary" onClick={() => void carregarPedidos()}>
                Tentar novamente
              </button>
            </div>
          )}
          {!pedidosCarregando && !pedidosErro && pedidos.length === 0 && <p className="balcao-vazio">Nenhum pedido pendente no momento.</p>}

          <div className="balcao-grid">
            {pedidos.map((pedido) => (
              <div className="pedido-card" key={pedido.id}>
                <div>
                  <div className="pedido-card__mesa">Mesa {pedido.mesa}</div>
                  {pedido.cliente_nome && <div className="pedido-card__cliente">{pedido.cliente_nome}</div>}
                  <div className="pedido-card__horario">{formatarHorario(pedido.criado_em)}</div>
                  <span className="pedido-card__status">Pendente</span>
                </div>
                <ListaItens itens={pedido.itens} />
                <div className="pedido-card__total">Total: {formatarPreco(pedido.total)}</div>
                <button type="button" className="btn btn--primary pedido-card__entregar" onClick={() => void marcarEntregue(pedido.id)}>
                  Entregue
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>

      <nav className="garcom-tabbar" aria-label="Navegação principal">
        <button type="button" className={`garcom-tabbar__item${aba === 'mesas' ? ' is-ativo' : ''}`} aria-current={aba === 'mesas' ? 'page' : 'false'} onClick={() => setAba('mesas')}>
          <span className="garcom-tabbar__label">Mesas</span>
        </button>
        <button type="button" className={`garcom-tabbar__item${aba === 'pedidos' ? ' is-ativo' : ''}`} aria-current={aba === 'pedidos' ? 'page' : 'false'} onClick={() => setAba('pedidos')}>
          <span className="garcom-tabbar__label">Pedidos</span>
          <span className="garcom-tabbar__badge" hidden={pedidos.length === 0}>
            {pedidos.length}
          </span>
        </button>
      </nav>

      <NovoPedidoModal mesa={novoPedidoMesa} onFechar={() => setNovoPedidoMesa(null)} />
      <ContaMesaModal
        mesa={contaMesa}
        onFechar={() => setContaMesa(null)}
        aoFechada={(mesa) => {
          setSessoes((l) => l.filter((s) => String(s.mesa) !== String(mesa)));
          setPedidos((l) => l.filter((p) => String(p.mesa) !== String(mesa)));
          controle.atualizarLocal(mesa, 'bloqueada');
          toast(`Conta da Mesa ${mesa} fechada.`);
        }}
      />
    </div>
  );
}

export default function Garcom() {
  useEffect(() => {
    document.title = 'AOOBA! — Garçom';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  return (
    <RequireAuth cliente={supabase} titulo="Garçom" papeis={['garcom', 'balcao', 'admin']} mensagemSemPermissao="Este usuário não tem permissão de garçom/balcão/admin.">
      {({ papel, sair }) => <GarcomConteudo papel={papel} sair={sair} />}
    </RequireAuth>
  );
}
