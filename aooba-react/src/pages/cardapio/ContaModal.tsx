import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { arredondar2, formatarPreco, STATUS_LABEL_PESSOA } from '../../lib/shared';
import { ehErroSessaoEncerrada } from '../../lib/sessaoCliente';
import type { ContaCliente, MinhaParte } from '../../lib/types';
import { useToast } from '../../components/Toast';
import type { SessaoCliente } from './useSessao';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  mesa: string;
  tokenMesa: string;
  clienteId: string;
  sessao: SessaoCliente;
}

function LinhasValores({ subtotal, taxa, total }: { subtotal: number; taxa: number; total: number }) {
  return (
    <>
      <div className="modal-panel__linha">
        <span>Subtotal</span>
        <span>{formatarPreco(subtotal)}</span>
      </div>
      <div className="modal-panel__linha">
        <span>Serviço</span>
        <span>{formatarPreco(taxa)}</span>
      </div>
      <div className="modal-panel__linha conta-minha-linha-total">
        <span>Total</span>
        <strong>{formatarPreco(total)}</strong>
      </div>
    </>
  );
}

function MinhaParteSecao({ minha, pct, aoFecharParte, fechando }: { minha: MinhaParte; pct: number; aoFecharParte: (aceitaTaxa: boolean, valor: number) => void; fechando: boolean }) {
  const [aceitaTaxa, setAceitaTaxa] = useState(true);
  const semNada = minha.itens_diretos.length === 0 && minha.itens_compartilhados.length === 0;

  const subtotal = minha.subtotal_em_aberto;
  const taxa = aceitaTaxa ? arredondar2((subtotal * pct) / 100) : 0;

  return (
    <section className="conta-secao">
      <h3 className="conta-secao__titulo">Minha parte</h3>

      {semNada ? (
        <p className="conta-minha-vazio">Você ainda não pediu nada nessa mesa.</p>
      ) : (
        <>
          <ul className="modal-panel__itens conta-minha-itens">
            {minha.itens_diretos.map((item, i) => (
              <li key={`d${i}`} className={`modal-panel__item conta-item${item.pago ? ' conta-item--pago' : ''}`}>
                <span>
                  {item.quantidade}x {item.nome}
                  {item.pago && <span className="conta-item__tag-pago">✓ pago</span>}
                </span>
                <span>{formatarPreco(item.preco * item.quantidade)}</span>
              </li>
            ))}
            {minha.itens_compartilhados.map((item, i) => (
              <li key={`c${i}`} className={`modal-panel__item conta-item${item.pago ? ' conta-item--pago' : ''}`}>
                <span>
                  {item.nome} (fração compartilhada)
                  {item.pago && <span className="conta-item__tag-pago">✓ pago</span>}
                </span>
                <span>{formatarPreco(item.valor)}</span>
              </li>
            ))}
          </ul>

          {minha.status === 'em_aberto' && (
            <div className="conta-minha-acao" style={{ display: 'flex' }}>
              <label className="conta-minha-taxa-toggle">
                <input type="checkbox" checked={aceitaTaxa} onChange={(e) => setAceitaTaxa(e.target.checked)} />
                Incluir <span>{pct}</span>% de serviço
              </label>
              <div className="modal-panel__linha">
                <span>Subtotal</span>
                <span>{formatarPreco(subtotal)}</span>
              </div>
              <div className="modal-panel__linha">
                <span>Serviço</span>
                <span>{formatarPreco(taxa)}</span>
              </div>
              <div className="modal-panel__total conta-minha-total">
                <span>Total</span>
                <span>{formatarPreco(subtotal + taxa)}</span>
              </div>
              <button type="button" className="btn btn--primary conta-minha-fechar" disabled={fechando} onClick={() => aoFecharParte(aceitaTaxa, subtotal + taxa)}>
                {fechando ? 'Fechando...' : 'Fechar minha parte'}
              </button>
            </div>
          )}

          {minha.status === 'aguardando' && (
            <div className="conta-minha-aviso" style={{ display: 'block' }}>
              <p>Sua parte foi enviada ao balcão. Aguarde o garçom.</p>
              <LinhasValores subtotal={minha.subtotal_aguardando} taxa={minha.taxa_aguardando} total={minha.total_aguardando} />
            </div>
          )}

          {minha.status === 'pago' && (
            <div className="conta-minha-aviso conta-minha-aviso--pago" style={{ display: 'block' }}>
              <p>Você já pagou sua parte.</p>
              <LinhasValores subtotal={minha.subtotal_pago} taxa={minha.taxa_pago} total={minha.total_pago} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ContaModal({ aberto, onFechar, mesa, tokenMesa, clienteId, sessao }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<string | null>('Consultando conta...');
  const [conta, setConta] = useState<ContaCliente | null>(null);
  const [fechandoParte, setFechandoParte] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const carregar = useCallback(async () => {
    setStatus('Consultando conta...');
    setConta(null);
    const { data, error } = await supabase.rpc('conta_da_mesa', {
      p_mesa: Number(mesa),
      p_token: tokenMesa,
      p_cliente_id: clienteId,
      p_token_sessao: sessao.tokenSessao,
    });
    if (error) {
      console.error('Erro ao consultar conta da mesa:', error);
      if (ehErroSessaoEncerrada(error)) {
        onFechar();
        sessao.mostrarContaFechada(sessao.sessaoId);
        return;
      }
      setStatus(error.message || 'Não foi possível consultar a conta agora. Verifique sua conexão e tente de novo.');
      return;
    }
    setConta(data as ContaCliente);
    setStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesa, tokenMesa, clienteId, sessao.tokenSessao, sessao.sessaoId]);

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto, carregar]);

  async function fecharMinhaParte(aceitaTaxa: boolean, valor: number) {
    if (!window.confirm(`Fechar sua parte no valor de ${formatarPreco(valor)}${aceitaTaxa ? '' : ' (sem taxa de serviço)'}?`)) return;

    setFechandoParte(true);
    const { data, error } = await supabase.rpc('fechar_parcial', {
      p_mesa: Number(mesa),
      p_token: tokenMesa,
      p_cliente_id: clienteId,
      p_aceita_taxa: aceitaTaxa,
    });
    setFechandoParte(false);

    if (error) {
      console.error('Erro ao fechar minha parte:', error);
      toast(error.message || 'Não foi possível fechar sua parte agora. Verifique sua conexão e tente de novo.');
      return;
    }
    toast(`Sua parte (${formatarPreco((data as { valor_total: number }).valor_total)}) foi enviada ao balcão. Aguarde o garçom.`);
    await carregar();
  }

  async function fecharContaToda() {
    setConfirmando(true);
    const { error } = await supabase.rpc('pedir_fechamento', { p_mesa: Number(mesa), p_token: tokenMesa, p_token_sessao: sessao.tokenSessao });
    setConfirmando(false);

    if (error) {
      console.error('Erro ao pedir fechamento:', error);
      if (ehErroSessaoEncerrada(error)) {
        onFechar();
        sessao.mostrarContaFechada(sessao.sessaoId);
        return;
      }
      toast(error.message || 'Não foi possível enviar o pedido de fechamento. Verifique sua conexão e tente de novo.');
      return;
    }
    onFechar();
    toast('Pedido de fechamento enviado! O garçom já foi avisado.');
  }

  return (
    <>
      <div className={`modal-overlay${aberto ? ' is-open' : ''}`} onClick={onFechar} />
      <div className={`modal-panel modal-panel--conta${aberto ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-labelledby="fecharContaTitulo">
        <div className="modal-panel__header">
          <span className="modal-panel__title" id="fecharContaTitulo">
            Conta — Mesa <span>{mesa}</span>
          </span>
          <button className="modal-panel__close" aria-label="Fechar" onClick={onFechar}>
            &times;
          </button>
        </div>

        {status && <p className="modal-panel__vazio">{status}</p>}

        {conta && (
          <div className="conta-conteudo" style={{ display: 'block' }}>
            <MinhaParteSecao minha={conta.minha_parte} pct={conta.taxa_servico_percentual} aoFecharParte={(a, v) => void fecharMinhaParte(a, v)} fechando={fechandoParte} />

            <section className="conta-secao">
              <h3 className="conta-secao__titulo">Conta da mesa</h3>
              {(!conta.itens || conta.itens.length === 0) && <p className="conta-mesa-vazio">Nenhum pedido registrado para essa mesa.</p>}
              <ul className="modal-panel__itens">
                {conta.itens?.map((item, i) => (
                  <li key={i} className="modal-panel__item">
                    <span>
                      {item.quantidade}x {item.nome}
                    </span>
                    <span>{formatarPreco(item.preco * item.quantidade)}</span>
                  </li>
                ))}
              </ul>

              <div className="modal-panel__resumo">
                <div className="modal-panel__linha">
                  <span>Subtotal</span>
                  <span>{formatarPreco(conta.subtotal)}</span>
                </div>
                <div className="modal-panel__linha">
                  <span>Serviço ({conta.taxa_servico_percentual}%)</span>
                  <span>{formatarPreco(conta.taxa_servico)}</span>
                </div>
                <div className="modal-panel__linha">
                  <span>Total geral</span>
                  <span>{formatarPreco(conta.total_geral)}</span>
                </div>
                <div className="modal-panel__linha">
                  <span>Já pago / aguardando confirmação</span>
                  <span>{formatarPreco(conta.total_pago + conta.total_pendente_confirmacao)}</span>
                </div>
              </div>
              <div className="modal-panel__total">
                <span>Saldo restante</span>
                <span>{formatarPreco(conta.saldo_restante)}</span>
              </div>

              <ul className="conta-pessoas">
                {conta.por_pessoa.map((pessoa, i) => (
                  <li key={i}>
                    <div className="conta-pessoas__linha-principal">
                      <span>
                        {pessoa.nome}
                        <span className={`conta-pessoas__status conta-pessoas__status--${pessoa.status}`}>{STATUS_LABEL_PESSOA[pessoa.status] || pessoa.status}</span>
                      </span>
                      <span>{formatarPreco(pessoa.valor)}</span>
                    </div>
                    <div className="conta-pessoas__detalhe">
                      Subtotal {formatarPreco(pessoa.subtotal)} + Serviço {formatarPreco(pessoa.taxa_servico)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <div className="modal-panel__acoes">
          <button className="btn btn--secondary" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn btn--primary" disabled={confirmando} onClick={() => void fecharContaToda()}>
            Fechar a conta toda
          </button>
        </div>
      </div>
    </>
  );
}
