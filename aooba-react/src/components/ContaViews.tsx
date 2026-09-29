import { formatarPreco, STATUS_LABEL_PESSOA } from '../lib/shared';
import type { ContaBalcao, ItemConta } from '../lib/types';

/** <ul> de itens (quantidade x nome, subtotal da linha). */
export function ListaItens({ itens }: { itens: ItemConta[] }) {
  return (
    <ul className="pedido-card__itens">
      {itens.map((item, i) => (
        <li key={i}>
          <span>
            {item.quantidade}x {item.nome}
          </span>
          <span>{formatarPreco(item.preco * item.quantidade)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Total/Pago/Falta da mesa + detalhe por pessoa (quando há mais de uma). */
export function ResumoConta({ conta }: { conta: ContaBalcao }) {
  return (
    <>
      <div className="fechamento-card__saldo">
        <span>
          Total <strong>{formatarPreco(conta.total_geral)}</strong>{' '}
          <span className="fechamento-card__saldo-servico">(serviço {formatarPreco(conta.taxa_servico)})</span>
        </span>
        <span>
          Pago <strong>{formatarPreco(conta.total_pago)}</strong>
        </span>
        <span className="falta">
          Falta <strong>{formatarPreco(conta.saldo_restante)}</strong>
        </span>
      </div>
      {conta.por_pessoa.length > 1 && (
        <div className="fechamento-card__pessoas">
          <div className="fechamento-card__pessoas-titulo">Por pessoa</div>
          {conta.por_pessoa.map((pessoa, i) => (
            <div key={i}>
              <div className="fechamento-card__linha">
                <span>
                  {pessoa.nome}
                  <span className={`fechamento-card__pessoa-status fechamento-card__pessoa-status--${pessoa.status}`}>
                    {STATUS_LABEL_PESSOA[pessoa.status] || pessoa.status}
                  </span>
                </span>
                <span>{formatarPreco(pessoa.valor)}</span>
              </div>
              <div className="fechamento-card__pessoa-detalhe">
                Subtotal {formatarPreco(pessoa.subtotal)} + Serviço {formatarPreco(pessoa.taxa_servico)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
