import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { supabaseGarcom as supabase } from '../../lib/supabase';
import { formatarPreco, LABEL_CATEGORIA, ORDEM_CATEGORIAS } from '../../lib/shared';
import type { Categoria, Produto } from '../../lib/types';

type ProdutoCardapio = Pick<Produto, 'id' | 'nome' | 'preco' | 'categoria'>;

/** Soma o carrinho { produtoId: quantidade } contra o cardápio. */
export function calcularTotalNovoPedido(carrinho: Record<number, number>, produtos: ProdutoCardapio[]) {
  let total = 0;
  let itens = 0;
  for (const [id, qtd] of Object.entries(carrinho)) {
    const produto = produtos.find((p) => String(p.id) === id);
    if (produto) total += produto.preco * qtd;
    itens += qtd;
  }
  return { total, itens };
}

export function NovoPedidoModal({ mesa, onFechar }: { mesa: number | null; onFechar: () => void }) {
  const toast = useToast();
  const [produtos, setProdutos] = useState<ProdutoCardapio[] | null>(null);
  const [carrinho, setCarrinho] = useState<Record<number, number>>({});
  const [nome, setNome] = useState('');
  const [lancando, setLancando] = useState(false);

  // Carrega o cardápio ativo na primeira abertura; zera o rascunho a cada mesa.
  useEffect(() => {
    if (mesa === null) return;
    setCarrinho({});
    setNome('');
    if (produtos) return;
    let vivo = true;
    void supabase
      .from('produtos')
      .select('id, nome, preco, categoria')
      .eq('ativo', true)
      .order('categoria')
      .order('ordem')
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          console.error('Erro ao carregar cardápio pro novo pedido:', error);
          window.alert('Não foi possível carregar o cardápio agora. Verifique sua conexão e tente de novo.');
          onFechar();
          return;
        }
        setProdutos(data as ProdutoCardapio[]);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesa]);

  const { total, itens } = useMemo(() => calcularTotalNovoPedido(carrinho, produtos ?? []), [carrinho, produtos]);

  function alterar(id: number, delta: number) {
    setCarrinho((c) => {
      const novo = Math.max(0, Math.min(50, (c[id] || 0) + delta));
      const { [id]: _removido, ...resto } = c;
      void _removido;
      return novo === 0 ? resto : { ...resto, [id]: novo };
    });
  }

  async function lancar() {
    if (itens === 0 || mesa === null) return;
    setLancando(true);
    const { error } = await supabase.rpc('lancar_pedido_garcom', {
      p_mesa: mesa,
      p_itens: Object.entries(carrinho).map(([id, quantidade]) => ({ produto_id: Number(id), quantidade })),
      p_cliente_nome: nome.trim() || null,
    });
    setLancando(false);

    if (error) {
      console.error('Erro ao lançar pedido:', error);
      window.alert(
        error.details === 'MESA_BLOQUEADA'
          ? 'A mesa foi bloqueada de novo antes do pedido ser lançado (talvez por um fechamento em outro aparelho). Feche, libere a mesa de novo e tente lançar o pedido.'
          : error.message || 'Não foi possível lançar o pedido agora. Verifique sua conexão e tente de novo.',
      );
      return;
    }
    onFechar();
    toast('Pedido lançado!');
  }

  const grupos = ORDEM_CATEGORIAS.map((c: Categoria) => ({ categoria: c, itens: (produtos ?? []).filter((p) => p.categoria === c) })).filter((g) => g.itens.length > 0);

  return (
    <Modal aberto={mesa !== null} onFechar={onFechar} titulo={<>Novo pedido — Mesa {mesa}</>} variante="modal-panel--novo-pedido">
      <label htmlFor="novoPedidoNome" className="nome-modal__label">
        Nome do cliente (opcional)
      </label>
      <input id="novoPedidoNome" type="text" className="nome-modal__input" placeholder="Ex: João" maxLength={20} value={nome} onChange={(e) => setNome(e.target.value)} />

      <div className="np-itens">
        {grupos.map((g) => (
          <div className="np-categoria" key={g.categoria}>
            <h3 className="np-categoria__titulo">{LABEL_CATEGORIA[g.categoria]}</h3>
            {g.itens.map((p) => {
              const qtd = carrinho[p.id] || 0;
              return (
                <div className="np-item" key={p.id}>
                  <div className="np-item__info">
                    <span className="np-item__nome">{p.nome}</span>
                    <span className="np-item__preco">{formatarPreco(p.preco)}</span>
                  </div>
                  <div className="np-item__qtd">
                    <button type="button" className="np-item__botao" aria-label={`Menos ${p.nome}`} disabled={qtd === 0} onClick={() => alterar(p.id, -1)}>
                      −
                    </button>
                    <span className="np-item__valor">{qtd}</span>
                    <button type="button" className="np-item__botao" aria-label={`Mais ${p.nome}`} onClick={() => alterar(p.id, 1)}>
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="np-rodape">
        <span className="np-rodape__total">
          Total: <strong>{formatarPreco(total)}</strong>
        </span>
        <button type="button" className="btn btn--primary" disabled={itens === 0 || lancando} onClick={() => void lancar()}>
          {lancando ? 'Lançando...' : 'Lançar pedido'}
        </button>
      </div>
    </Modal>
  );
}
