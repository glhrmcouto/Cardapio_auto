import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AdminLayout } from '../components/AdminLayout';
import { FeedbackLinha, StatusCarregando, useFeedback } from '../components/Feedback';
import { supabase } from '../lib/supabase';
import { formatarPreco, LABEL_CATEGORIA, ORDEM_CATEGORIAS } from '../lib/shared';
import type { Categoria, Produto } from '../lib/types';

function mascaraPreco(bruto: string): string {
  const digitos = bruto.replace(/\D/g, '');
  return formatarPreco(parseInt(digitos || '0', 10) / 100);
}

function precoParaNumero(mascarado: string): number {
  return parseInt(mascarado.replace(/\D/g, '') || '0', 10) / 100;
}

interface Rascunho {
  nome: string;
  descricao: string;
  preco: string; // mascarado
  categoria: Categoria;
  ordem: string;
}

function CategoriaOptions() {
  return (
    <>
      {ORDEM_CATEGORIAS.map((c) => (
        <option key={c} value={c}>
          {LABEL_CATEGORIA[c]}
        </option>
      ))}
    </>
  );
}

interface CardProps {
  produto?: Produto;
  inicial: Rascunho;
  ordemPara: (categoria: Categoria) => number;
  /** Só no card existente. */
  onAlternarAtivo?: () => Promise<string | null>;
  onExcluir?: () => Promise<string | null>;
  onMover?: (dir: 'subir' | 'descer') => Promise<string | null>;
  /** Devolve mensagem de erro ou null. */
  onSalvar: (campos: { nome: string; descricao: string; preco: number; categoria: Categoria; ordem: number }) => Promise<string | null>;
  onCancelar?: () => void;
}

function ProdutoCard({ produto, inicial, ordemPara, onAlternarAtivo, onExcluir, onMover, onSalvar, onCancelar }: CardProps) {
  const novo = !produto;
  const [campos, setCampos] = useState<Rascunho>(inicial);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useFeedback();

  // Quando os dados do produto mudam por fora (reordenar, salvar), sincroniza.
  const chaveInicial = JSON.stringify(inicial);
  useEffect(() => {
    setCampos(JSON.parse(chaveInicial) as Rascunho);
  }, [chaveInicial]);

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setCampos((c) => ({ ...c, [k]: v }));

  async function executar(nome: string, fn: () => Promise<string | null>, sucesso?: string) {
    setOcupado(nome);
    const erro = await fn();
    setOcupado(null);
    if (erro) setMsg({ texto: erro, tipo: 'erro' });
    else if (sucesso) setMsg({ texto: sucesso, tipo: 'sucesso' });
  }

  function salvar() {
    const nome = campos.nome.trim();
    const preco = precoParaNumero(campos.preco);
    const ordem = parseInt(campos.ordem, 10);
    if (!nome) return setMsg({ texto: 'O nome não pode ficar vazio.', tipo: 'erro' });
    if (!Number.isFinite(preco) || preco < 0) return setMsg({ texto: 'Preço inválido.', tipo: 'erro' });
    if (!Number.isFinite(ordem) || ordem < 0) return setMsg({ texto: 'Ordem inválida.', tipo: 'erro' });
    void executar(
      novo ? 'criar' : 'salvar',
      () => onSalvar({ nome, descricao: campos.descricao.trim(), preco, categoria: campos.categoria, ordem }),
      novo ? undefined : 'Salvo com sucesso!',
    );
  }

  const ativo = produto?.ativo ?? true;
  return (
    <div className={`admin-produto-card${ativo ? '' : ' admin-produto-card--inativo'}${novo ? ' admin-produto-card--novo' : ''}`}>
      <div className="admin-produto-card__topo">
        <span className={`admin-produto-card__status ${novo ? 'admin-produto-card__status--novo' : ativo ? 'admin-produto-card__status--ativo' : 'admin-produto-card__status--inativo'}`}>
          {novo ? 'Novo produto' : ativo ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <div className="admin-produto-card__campo">
        <label>Nome</label>
        <input type="text" className="admin-produto-card__input" value={campos.nome} placeholder={novo ? 'Ex: Caipirinha' : undefined} autoFocus={novo} onChange={(e) => set('nome', e.target.value)} />
      </div>

      <div className="admin-produto-card__campo">
        <label>Descrição</label>
        <textarea className="admin-produto-card__input" rows={2} value={campos.descricao} placeholder={novo ? 'Descrição curta do item' : undefined} onChange={(e) => set('descricao', e.target.value)} />
      </div>

      <div className="admin-produto-card__linha">
        <div className="admin-produto-card__campo">
          <label>Preço</label>
          <input type="text" inputMode="numeric" className="admin-produto-card__input" value={campos.preco} onChange={(e) => set('preco', mascaraPreco(e.target.value))} />
        </div>
        <div className="admin-produto-card__campo">
          <label>Categoria</label>
          <select
            className="admin-produto-card__input"
            value={campos.categoria}
            onChange={(e) => {
              const categoria = e.target.value as Categoria;
              setCampos((c) => ({ ...c, categoria, ordem: novo ? String(ordemPara(categoria)) : c.ordem }));
            }}
          >
            <CategoriaOptions />
          </select>
        </div>
      </div>

      <div className="admin-produto-card__campo admin-produto-card__campo--ordem">
        <label>Ordem na categoria</label>
        <div className="admin-produto-card__ordem-controles">
          {!novo && (
            <button type="button" className="admin-produto-card__seta" aria-label="Mover pra cima na categoria" onClick={() => void executar('subir', () => onMover!('subir'))}>
              ▲
            </button>
          )}
          <input type="number" min={0} className="admin-produto-card__input admin-produto-card__ordem-input" value={campos.ordem} onChange={(e) => set('ordem', e.target.value)} />
          {!novo && (
            <button type="button" className="admin-produto-card__seta" aria-label="Mover pra baixo na categoria" onClick={() => void executar('descer', () => onMover!('descer'))}>
              ▼
            </button>
          )}
        </div>
      </div>

      <div className="admin-produto-card__acoes">
        {novo ? (
          <>
            <button type="button" className="btn btn--secondary" onClick={onCancelar}>
              Cancelar
            </button>
            <button type="button" className="btn btn--primary" disabled={ocupado === 'criar'} onClick={salvar}>
              {ocupado === 'criar' ? 'Criando...' : 'Criar produto'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn admin-produto-card__excluir"
              disabled={ocupado === 'excluir'}
              onClick={() => {
                if (!window.confirm(`Tem certeza que deseja excluir "${produto!.nome}"? Essa ação não pode ser desfeita.`)) return;
                void executar('excluir', onExcluir!);
              }}
            >
              {ocupado === 'excluir' ? 'Excluindo...' : 'Excluir'}
            </button>
            <button type="button" className="btn btn--secondary" disabled={ocupado === 'ativo'} onClick={() => void executar('ativo', onAlternarAtivo!)}>
              {ativo ? 'Desativar' : 'Ativar'}
            </button>
            <button type="button" className="btn btn--primary" disabled={ocupado === 'salvar'} onClick={salvar}>
              {ocupado === 'salvar' ? 'Salvando...' : 'Salvar'}
            </button>
          </>
        )}
      </div>
      <FeedbackLinha msg={msg} />
    </div>
  );
}

function ConfigTaxa() {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [valor, setValor] = useState('10');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useFeedback();

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    const { data, error } = await supabase.from('configuracoes').select('valor').eq('chave', 'taxa_servico_percentual').maybeSingle();
    if (error) {
      console.error('Erro ao carregar configurações:', error);
      setErro(true);
    } else {
      setValor(data ? data.valor : '10');
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const percentual = parseFloat(valor);
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
      setMsg({ texto: 'Percentual inválido (deve ser entre 0 e 100).', tipo: 'erro' });
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from('configuracoes').update({ valor: String(percentual) }).eq('chave', 'taxa_servico_percentual');
    setSalvando(false);
    if (error) {
      console.error('Erro ao salvar taxa de serviço:', error);
      setMsg({ texto: 'Não foi possível salvar agora. Verifique sua conexão e tente de novo.', tipo: 'erro' });
      return;
    }
    setMsg({ texto: percentual === 0 ? 'Salvo! Taxa de serviço desativada.' : 'Salvo com sucesso!', tipo: 'sucesso' });
  }

  return (
    <>
      <div className="admin-toolbar">
        <h1 className="admin-titulo">Taxa de serviço</h1>
      </div>
      <StatusCarregando carregando={carregando} erro={erro} textoCarregando="Carregando configurações..." textoErro="Não foi possível carregar as configurações agora. Verifique sua conexão e tente de novo." aoTentar={() => void carregar()} />
      {!carregando && !erro && (
        <form className="admin-config-card" style={{ display: 'flex' }} onSubmit={salvar}>
          <div className="admin-produto-card__campo">
            <label htmlFor="taxaServicoInput">Taxa de serviço (%)</label>
            <input id="taxaServicoInput" type="number" min={0} max={100} step={0.1} required value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <p className="admin-config-aviso">Deixe em 0 pra não cobrar taxa de serviço nenhuma.</p>
          <button type="submit" className="btn btn--primary" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
          <FeedbackLinha msg={msg} />
        </form>
      )}
    </>
  );
}

function produtoParaRascunho(p: Produto): Rascunho {
  return { nome: p.nome, descricao: p.descricao, preco: formatarPreco(p.preco), categoria: p.categoria, ordem: String(p.ordem) };
}

export default function Admin() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    const { data, error } = await supabase
      .from('produtos')
      .select('id, nome, descricao, preco, categoria, ativo, ordem')
      .order('categoria')
      .order('ordem');
    if (error) {
      console.error('Erro ao carregar produtos:', error);
      setErro(true);
    } else {
      setProdutos(data as Produto[]);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const proximaOrdem = (categoria: Categoria) => {
    const grupo = produtos.filter((p) => p.categoria === categoria);
    return grupo.length === 0 ? 1 : Math.max(...grupo.map((p) => p.ordem)) + 1;
  };

  async function salvar(p: Produto, campos: Omit<Produto, 'id' | 'ativo'>) {
    const { error } = await supabase.from('produtos').update(campos).eq('id', p.id);
    if (error) {
      console.error('Erro ao salvar produto:', error);
      return 'Não foi possível salvar. Verifique sua conexão e tente de novo.';
    }
    setProdutos((lista) => lista.map((x) => (x.id === p.id ? { ...x, ...campos } : x)));
    return null;
  }

  async function alternarAtivo(p: Produto) {
    const { error } = await supabase.from('produtos').update({ ativo: !p.ativo }).eq('id', p.id);
    if (error) {
      console.error('Erro ao ativar/desativar produto:', error);
      return 'Não foi possível atualizar o status. Tente de novo.';
    }
    setProdutos((lista) => lista.map((x) => (x.id === p.id ? { ...x, ativo: !p.ativo } : x)));
    return null;
  }

  async function excluir(p: Produto) {
    const { error } = await supabase.from('produtos').delete().eq('id', p.id);
    if (error) {
      if (error.code === '23503') return 'Este produto já foi pedido alguma vez — não dá pra excluir. Desative-o em vez disso.';
      console.error('Erro ao excluir produto:', error);
      return 'Não foi possível excluir agora. Verifique sua conexão e tente de novo.';
    }
    setProdutos((lista) => lista.filter((x) => x.id !== p.id));
    return null;
  }

  async function mover(p: Produto, direcao: 'subir' | 'descer') {
    const grupo = produtos.filter((x) => x.categoria === p.categoria).sort((a, b) => a.ordem - b.ordem);
    const i = grupo.findIndex((x) => x.id === p.id);
    const vizinho = grupo[direcao === 'subir' ? i - 1 : i + 1];
    if (!vizinho) return null;

    const [r1, r2] = await Promise.all([
      supabase.from('produtos').update({ ordem: vizinho.ordem }).eq('id', p.id),
      supabase.from('produtos').update({ ordem: p.ordem }).eq('id', vizinho.id),
    ]);
    if (r1.error || r2.error) {
      console.error('Erro ao reordenar produtos:', r1.error || r2.error);
      return 'Não foi possível reordenar agora. Tente de novo.';
    }
    setProdutos((lista) =>
      lista.map((x) => (x.id === p.id ? { ...x, ordem: vizinho.ordem } : x.id === vizinho.id ? { ...x, ordem: p.ordem } : x)),
    );
    return null;
  }

  async function criar(campos: Omit<Produto, 'id' | 'ativo'>) {
    const { data, error } = await supabase.from('produtos').insert({ ...campos, ativo: true }).select().single();
    if (error) {
      console.error('Erro ao criar produto:', error);
      return 'Não foi possível criar o produto. Verifique sua conexão e tente de novo.';
    }
    setProdutos((lista) => [...lista, data as Produto]);
    setNovoAberto(false);
    return null;
  }

  const grupos = ORDEM_CATEGORIAS.map((c) => ({
    categoria: c,
    itens: produtos.filter((p) => p.categoria === c).sort((a, b) => a.ordem - b.ordem),
  })).filter((g) => g.itens.length > 0);

  const categoriaInicial = ORDEM_CATEGORIAS[0];

  return (
    <AdminLayout atual="admin" titulo="Administrador" docTitle="AOOBA! — Administrador">
      <div className="admin-toolbar">
        <h1 className="admin-titulo">Cardápio</h1>
        <button type="button" className="btn btn--primary" onClick={() => setNovoAberto(true)}>
          + Adicionar produto
        </button>
      </div>

      <StatusCarregando carregando={carregando} erro={erro} textoCarregando="Carregando produtos..." textoErro="Não foi possível carregar os produtos agora. Verifique sua conexão e tente de novo." aoTentar={() => void carregar()} />

      {novoAberto && (
        <ProdutoCard
          inicial={{ nome: '', descricao: '', preco: 'R$ 0,00', categoria: categoriaInicial, ordem: String(proximaOrdem(categoriaInicial)) }}
          ordemPara={proximaOrdem}
          onSalvar={criar}
          onCancelar={() => setNovoAberto(false)}
        />
      )}

      {!carregando &&
        grupos.map((g) => (
          <section key={g.categoria} className="admin-categoria">
            <h2 className="admin-categoria__titulo">{LABEL_CATEGORIA[g.categoria]}</h2>
            <div className="admin-categoria__lista">
              {g.itens.map((p) => (
                <ProdutoCard
                  key={p.id}
                  produto={p}
                  inicial={produtoParaRascunho(p)}
                  ordemPara={proximaOrdem}
                  onSalvar={(c) => salvar(p, c)}
                  onAlternarAtivo={() => alternarAtivo(p)}
                  onExcluir={() => excluir(p)}
                  onMover={(d) => mover(p, d)}
                />
              ))}
            </div>
          </section>
        ))}

      <ConfigTaxa />
    </AdminLayout>
  );
}
