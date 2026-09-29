import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AdminLayout } from '../components/AdminLayout';
import { FeedbackLinha, StatusCarregando, useFeedback } from '../components/Feedback';
import { supabase } from '../lib/supabase';
import { montarUrlMesa } from '../lib/shared';
import type { Mesa } from '../lib/types';

type MesaAdmin = Pick<Mesa, 'numero' | 'token' | 'ativa'>;

function MesaCard({
  mesa,
  onAlternar,
  onRegerar,
}: {
  mesa: MesaAdmin;
  onAlternar: () => Promise<string | null>;
  onRegerar: () => Promise<string | null>;
}) {
  const [msg, setMsg] = useFeedback();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(montarUrlMesa(mesa));
      setMsg({ texto: 'Link copiado!', tipo: 'sucesso' });
    } catch (erro) {
      console.error('Erro ao copiar link da mesa:', erro);
      urlRef.current?.select();
      setMsg({ texto: 'Não copiou sozinho — o link já está selecionado, copie manualmente (Ctrl+C).', tipo: 'erro' });
    }
  }

  async function executar(nome: string, fn: () => Promise<string | null>, sucesso: string) {
    setOcupado(nome);
    const erro = await fn();
    setOcupado(null);
    setMsg(erro ? { texto: erro, tipo: 'erro' } : { texto: sucesso, tipo: 'sucesso' });
  }

  return (
    <div className={`admin-produto-card admin-mesa-card${mesa.ativa ? '' : ' admin-produto-card--inativo'}`}>
      <div className="admin-produto-card__topo">
        <span className="admin-mesa-card__numero">Mesa {mesa.numero}</span>
        <span className={`admin-produto-card__status ${mesa.ativa ? 'admin-produto-card__status--ativo' : 'admin-produto-card__status--inativo'}`}>
          {mesa.ativa ? 'Ativa' : 'Inativa'}
        </span>
      </div>

      <div className="admin-produto-card__campo">
        <label>Link do QR code</label>
        <input ref={urlRef} type="text" className="admin-produto-card__input admin-mesa-card__url" value={montarUrlMesa(mesa)} readOnly />
      </div>

      <div className="admin-produto-card__acoes">
        <button type="button" className="btn btn--secondary" onClick={() => void copiar()}>
          Copiar link
        </button>
        <button type="button" className="btn btn--secondary" disabled={ocupado === 'alt'} onClick={() => void executar('alt', onAlternar, mesa.ativa ? 'Mesa desativada.' : 'Mesa ativada.')}>
          {mesa.ativa ? 'Desativar' : 'Ativar'}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={ocupado === 'tok'}
          onClick={() => {
            if (!window.confirm(`Gerar um novo link pra mesa ${mesa.numero}? O QR code impresso hoje vai parar de funcionar assim que você confirmar.`)) return;
            void executar('tok', onRegerar, 'Novo link gerado! Reimprima o QR code dessa mesa.');
          }}
        >
          {ocupado === 'tok' ? 'Gerando...' : 'Regerar token'}
        </button>
      </div>
      <FeedbackLinha msg={msg} />
    </div>
  );
}

function MesasConteudo() {
  const [mesas, setMesas] = useState<MesaAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [numeroNovo, setNumeroNovo] = useState('');
  const [adicionando, setAdicionando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    const { data, error } = await supabase.from('mesas').select('numero, token, ativa').order('numero');
    if (error) {
      console.error('Erro ao carregar mesas:', error);
      setErro(true);
    } else {
      setMesas(data as MesaAdmin[]);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternar(m: MesaAdmin) {
    const { error } = await supabase.from('mesas').update({ ativa: !m.ativa }).eq('numero', m.numero);
    if (error) {
      console.error('Erro ao ativar/desativar mesa:', error);
      return 'Não foi possível atualizar o status. Tente de novo.';
    }
    setMesas((l) => l.map((x) => (x.numero === m.numero ? { ...x, ativa: !m.ativa } : x)));
    return null;
  }

  async function regerar(m: MesaAdmin) {
    const { data, error } = await supabase.rpc('regenerar_token_mesa', { p_numero: m.numero });
    if (error) {
      console.error('Erro ao regerar token da mesa:', error);
      return 'Não foi possível gerar um novo link agora. Tente de novo.';
    }
    setMesas((l) => l.map((x) => (x.numero === m.numero ? { ...x, ...(data as Partial<MesaAdmin>) } : x)));
    return null;
  }

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    const numero = parseInt(numeroNovo, 10);
    if (!Number.isFinite(numero) || numero <= 0) return;

    setAdicionando(true);
    const { data, error } = await supabase.from('mesas').insert({ numero }).select('numero, token, ativa').single();
    setAdicionando(false);

    if (error) {
      console.error('Erro ao adicionar mesa:', error);
      window.alert(error.code === '23505' ? `A mesa ${numero} já existe.` : 'Não foi possível adicionar a mesa agora. Verifique sua conexão e tente de novo.');
      return;
    }
    setNumeroNovo('');
    setMesas((l) => [...l, data as MesaAdmin].sort((a, b) => a.numero - b.numero));
  }

  return (
    <>
      <div className="admin-toolbar admin-toolbar--mesas">
        <h1 className="admin-titulo">Mesas</h1>
        <form className="admin-mesa-nova" onSubmit={adicionar}>
          <input type="number" min={1} placeholder="Nº da mesa" required value={numeroNovo} onChange={(e) => setNumeroNovo(e.target.value)} />
          <button type="submit" className="btn btn--primary" disabled={adicionando}>
            + Adicionar mesa
          </button>
        </form>
      </div>

      <StatusCarregando carregando={carregando} erro={erro} textoCarregando="Carregando mesas..." textoErro="Não foi possível carregar as mesas agora. Verifique sua conexão e tente de novo." aoTentar={() => void carregar()} />

      {!carregando && !erro && (
        <div className="admin-mesas-grid">
          {mesas.length === 0 ? (
            <p className="cardapio-status">Nenhuma mesa cadastrada ainda — adicione uma acima.</p>
          ) : (
            mesas.map((m) => <MesaCard key={m.numero} mesa={m} onAlternar={() => alternar(m)} onRegerar={() => regerar(m)} />)
          )}
        </div>
      )}
    </>
  );
}

export default function Mesas() {
  return (
    <AdminLayout atual="mesas" titulo="Mesas" docTitle="AOOBA! — Mesas">
      <MesasConteudo />
    </AdminLayout>
  );
}
