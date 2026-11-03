import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  decidirComSessao,
  decidirSemSessao,
  ehErroMesaBloqueada,
  gravarClienteNome,
  gravarSessaoStorage,
  lerClienteNome,
  lerContaEncerrada,
  lerSessaoStorage,
  limparContaEncerrada,
  limparSessaoStorage,
  marcarContaEncerrada,
} from '../../lib/sessaoCliente';
import type { SessaoAtual } from '../../lib/types';
import { useToast } from '../../components/Toast';

/**
 * Telas do cardápio, conforme a sessão da mesa:
 *  acesso_bloqueado  — sem mesa+token válidos na URL (só re-escanear o QR);
 *  boas_vindas       — mesa livre, cliente novo ("Iniciar pedido");
 *  conta_encerrada   — este aparelho tinha sessão que já fechou;
 *  confirmar_entrada — já há sessão aberta e este navegador não a tinha ("Entrar na conta");
 *  entrada_cancelada — a pessoa recusou entrar;
 *  mesa_bloqueada    — aguardando liberação do garçom (polling); a pessoa informa o nome e o garçom
 *                      confirma que ela está na mesa (fila de aprovação, ver `solicitacao`);
 *  liberada          — pode pedir.
 */
export type TelaSessao =
  | 'carregando'
  | 'acesso_bloqueado'
  | 'boas_vindas'
  | 'conta_encerrada'
  | 'confirmar_entrada'
  | 'entrada_cancelada'
  | 'mesa_bloqueada'
  | 'liberada';

const INTERVALO_POLL_BLOQUEADA = 8000;
/** Mesmo limite do nome no pedido e da RPC solicitar_entrada. */
const NOME_MAX = 20;

interface Params {
  mesa: string;
  tokenMesa: string;
  temAcessoValido: boolean;
  clienteId: string;
}

export function useSessao({ mesa, tokenMesa, temAcessoValido, clienteId }: Params) {
  const toast = useToast();
  const [tela, setTela] = useState<TelaSessao>(temAcessoValido ? 'carregando' : 'acesso_bloqueado');
  const [sessao, setSessao] = useState<{ id: string; token: string } | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  /** Fila de aprovação (só em `mesa_bloqueada`): null = ainda não pediu; 'pendente' = aguarda o garçom; 'recusada' = o garçom não confirmou. */
  const [solicitacao, setSolicitacao] = useState<'pendente' | 'recusada' | null>(null);
  const [nomeSolicitado, setNomeSolicitado] = useState('');
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const pendenteRef = useRef<SessaoAtual | null>(null);
  const sessaoIdRef = useRef<string | null>(null);
  sessaoIdRef.current = sessao?.id ?? null;

  const salvar = useCallback(
    (id: string, token: string) => {
      setSessao({ id, token });
      gravarSessaoStorage(id, token, mesa);
      limparContaEncerrada();
    },
    [mesa],
  );

  const travar = useCallback((proxima: TelaSessao) => {
    setSessao(null);
    limparSessaoStorage();
    setSolicitacao(null);
    setNomeSolicitado('');
    setTela(proxima);
  }, []);

  /** Chamada quando o servidor recusa por SESSAO_ENCERRADA ou o Realtime avisa. */
  const mostrarContaFechada = useCallback(
    (sessaoIdEncerrada: string | null) => {
      pendenteRef.current = null;
      marcarContaEncerrada(mesa, sessaoIdEncerrada);
      travar('conta_encerrada');
    },
    [mesa, travar],
  );

  const mostrarMesaBloqueada = useCallback(() => {
    pendenteRef.current = null;
    travar('mesa_bloqueada');
  }, [travar]);

  const verificar = useCallback(async () => {
    if (!mesa) return;
    const guardada = lerSessaoStorage(mesa);

    async function semSessao() {
      let statusMesa: string | null = null;
      try {
        const { data, error } = await supabase.rpc('status_da_mesa', { p_mesa: Number(mesa), p_token: tokenMesa });
        if (error) throw error;
        statusMesa = data as string;
      } catch (erro) {
        // Sem confirmar o status, segue pela decisão normal em vez de liberar boas-vindas às cegas.
        console.error('Erro ao consultar status da mesa:', erro);
      }
      const decisao = decidirSemSessao({ statusMesa, guardada, marca: lerContaEncerrada(mesa) });
      pendenteRef.current = null;
      if (decisao.tela === 'conta_encerrada') mostrarContaFechada(decisao.sessaoIdEncerrada);
      else travar(decisao.tela);
    }

    try {
      const { data, error } = await supabase.rpc('sessao_atual', { p_mesa: Number(mesa), p_token: tokenMesa });
      if (error) throw error;
      if (!data) {
        await semSessao();
        return;
      }
      const atual = data as SessaoAtual;
      if (decidirComSessao(atual, guardada) === 'entrar') {
        salvar(atual.sessao_id, atual.token_sessao);
        setTela('liberada');
      } else {
        pendenteRef.current = atual;
        travar('confirmar_entrada');
      }
    } catch (erro) {
      console.error('Erro ao consultar sessão atual:', erro);
      await semSessao();
    }
  }, [mesa, tokenMesa, salvar, travar, mostrarContaFechada]);

  // Checagem inicial: sempre reconferida com o servidor no carregamento.
  useEffect(() => {
    if (temAcessoValido) void verificar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling de "mesa aguardando liberação" (status_da_mesa é leve e sem segredo).
  useEffect(() => {
    if (tela !== 'mesa_bloqueada') return;
    const id = window.setInterval(async () => {
      try {
        const { data, error } = await supabase.rpc('status_da_mesa', { p_mesa: Number(mesa), p_token: tokenMesa });
        if (error) throw error;
        if (data === 'liberada') {
          void verificar();
          return;
        }
        if (solicitacao === 'pendente') {
          const r = await supabase.rpc('status_solicitacao', { p_mesa: Number(mesa), p_token: tokenMesa, p_cliente_id: clienteId });
          if (r.error) throw r.error;
          if (r.data === 'recusada') setSolicitacao((atual) => (atual === 'pendente' ? 'recusada' : atual));
        }
      } catch (erro) {
        console.error('Erro ao checar liberação da mesa:', erro);
      }
    }, INTERVALO_POLL_BLOQUEADA);
    return () => window.clearInterval(id);
  }, [tela, mesa, tokenMesa, clienteId, solicitacao, verificar]);

  // Reabrir a página não perde o pedido que já está na fila do garçom (erro de rede só deixa sem retomar).
  useEffect(() => {
    if (tela !== 'mesa_bloqueada') return;
    let cancelado = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('status_solicitacao', { p_mesa: Number(mesa), p_token: tokenMesa, p_cliente_id: clienteId });
        if (error) throw error;
        if (!cancelado && data === 'pendente') {
          setSolicitacao('pendente');
          setNomeSolicitado(lerClienteNome());
        }
      } catch (erro) {
        console.error('Erro ao retomar o pedido de liberação:', erro);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [tela, mesa, tokenMesa, clienteId]);

  /** Pede ao garçom para confirmar que `nome` está na mesa (fila de aprovação). */
  async function pedirLiberacao(nome: string) {
    const limpo = nome.trim();
    if (enviandoSolicitacao) return;
    if (!limpo || limpo.length > NOME_MAX) {
      toast(`Informe seu nome (até ${NOME_MAX} caracteres).`);
      return;
    }
    setEnviandoSolicitacao(true);
    try {
      const { data, error } = await supabase.rpc('solicitar_entrada', { p_mesa: Number(mesa), p_token: tokenMesa, p_cliente_id: clienteId, p_nome: limpo });
      if (error) throw error;
      gravarClienteNome(limpo); // o cardápio não pergunta de novo
      if ((data as { status: string }).status === 'aprovada') {
        void verificar(); // a mesa já estava liberada
      } else {
        setNomeSolicitado(limpo);
        setSolicitacao('pendente');
      }
    } catch (erro) {
      console.error('Erro ao pedir liberação da mesa:', erro);
      toast((erro as { message?: string }).message || 'Não foi possível pedir a liberação agora. Tente de novo.');
    } finally {
      setEnviandoSolicitacao(false);
    }
  }

  // Trava em tempo real (só conforto; a defesa real é o token de sessão no banco).
  useEffect(() => {
    if (!sessao) return;
    const id = sessao.id;
    const canal = supabase
      .channel(`sessao-cliente-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessoes', filter: `id=eq.${id}` }, (payload) => {
        if ((payload.new as { status: string }).status === 'fechada') mostrarContaFechada(id);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [sessao?.id, mostrarContaFechada]);

  /** Único caminho de CRIAÇÃO de sessão — só sob toque explícito em "Iniciar pedido". */
  async function iniciarPedido() {
    if (!mesa) return;
    setAbrindo(true);
    try {
      const { data, error } = await supabase.rpc('abrir_sessao', { p_mesa: Number(mesa), p_token: tokenMesa });
      if (error) throw error;
      const nova = data as SessaoAtual;
      salvar(nova.sessao_id, nova.token_sessao);
      setTela('liberada');
    } catch (erro) {
      console.error('Erro ao abrir novo pedido:', erro);
      const e = erro as { message?: string; details?: string | null };
      if (ehErroMesaBloqueada({ message: e.message ?? '', details: e.details })) {
        mostrarMesaBloqueada();
        return;
      }
      toast(e.message || 'Não foi possível iniciar o pedido agora. Verifique sua conexão e tente de novo.');
    } finally {
      setAbrindo(false);
    }
  }

  /** "Entrar na conta": adota o token vigente já vindo de sessao_atual. */
  function entrarNaSessao() {
    const pendente = pendenteRef.current;
    if (!pendente) return;
    pendenteRef.current = null;
    salvar(pendente.sessao_id, pendente.token_sessao);
    setTela('liberada');
  }

  function cancelarEntrada() {
    pendenteRef.current = null;
    travar('entrada_cancelada');
  }

  return {
    tela,
    sessaoId: sessao?.id ?? null,
    tokenSessao: sessao?.token ?? null,
    abrindo,
    solicitacao,
    nomeSolicitado,
    enviandoSolicitacao,
    pedirLiberacao,
    iniciarPedido,
    entrarNaSessao,
    cancelarEntrada,
    mostrarContaFechada,
    mostrarMesaBloqueada,
  };
}

export type SessaoCliente = ReturnType<typeof useSessao>;
