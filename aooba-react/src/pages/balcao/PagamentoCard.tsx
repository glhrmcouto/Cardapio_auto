import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatarHorario, formatarPreco } from '../../lib/shared';
import type { ItemCompartilhado, ItemDireto, PagamentoComMesa } from '../../lib/types';

interface Detalhe {
  itens_diretos: ItemDireto[];
  itens_compartilhados: ItemCompartilhado[];
}

/** Pagamento parcial pendente ("fechar minha parte"): busca o detalhe via RPC detalhe_pagamento. */
export function PagamentoCard({ pagamento, onConfirmar }: { pagamento: PagamentoComMesa; onConfirmar: () => Promise<void> }) {
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void supabase.rpc('detalhe_pagamento', { p_pagamento_id: pagamento.id }).then(({ data, error }) => {
      if (vivo) setDetalhe(error || !data ? null : (data as Detalhe));
    });
    return () => {
      vivo = false;
    };
  }, [pagamento.id]);

  return (
    <div className="pagamento-card">
      <div className="pagamento-card__titulo">
        MESA {pagamento.mesa} — <strong>{pagamento.nome}</strong> quer fechar: {formatarPreco(pagamento.valor_total)}
      </div>
      <div className="pagamento-card__horario">{formatarHorario(pagamento.criado_em)}</div>
      {!pagamento.taxa_aceita && <div className="pagamento-card__sem-taxa">⚠️ Recusou a taxa de serviço</div>}
      <ul className="pagamento-card__itens">
        {detalhe?.itens_diretos.map((item, i) => (
          <li key={`d${i}`}>
            <span>
              {item.quantidade}x {item.nome}
            </span>
            <span>{formatarPreco(item.preco * item.quantidade)}</span>
          </li>
        ))}
        {detalhe?.itens_compartilhados.map((item, i) => (
          <li key={`c${i}`}>
            <span>{item.nome} (fração compartilhada)</span>
            <span>{formatarPreco(item.valor)}</span>
          </li>
        ))}
      </ul>
      <div className="pagamento-card__resumo">
        <div className="pagamento-card__linha">
          <span>Subtotal</span>
          <span>{formatarPreco(pagamento.subtotal)}</span>
        </div>
        <div className="pagamento-card__linha">
          <span>Serviço</span>
          <span>{formatarPreco(pagamento.taxa_servico)}</span>
        </div>
        <div className="pagamento-card__linha pagamento-card__linha--total">
          <span>Total</span>
          <span>{formatarPreco(pagamento.valor_total)}</span>
        </div>
      </div>
      <button
        className="btn btn--primary pagamento-card__ok"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          await onConfirmar();
          setOcupado(false);
        }}
      >
        {ocupado ? 'Marcando...' : 'Recebido'}
      </button>
    </div>
  );
}
