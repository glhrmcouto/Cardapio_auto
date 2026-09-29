import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatarPreco } from '../lib/shared';
import {
  adicionarItem,
  alterarQuantidade,
  itensPayload,
  removerItem,
  totalCarrinho,
  totalItens,
  type ItemCarrinho,
} from '../lib/carrinho';
import { ehErroMesaBloqueada, ehErroSessaoEncerrada, gravarClienteNome, lerClienteNome, obterOuCriarClienteId } from '../lib/sessaoCliente';
import type { Produto } from '../lib/types';
import { useToast } from '../components/Toast';
import { useSessao } from './cardapio/useSessao';
import { TravaModal } from './cardapio/TravaModal';
import { NomeModal } from './cardapio/NomeModal';
import { ContaModal } from './cardapio/ContaModal';
import '../styles/cardapio.css';

type ProdutoMenu = Pick<Produto, 'id' | 'nome' | 'descricao' | 'preco' | 'categoria'>;

function useOffline() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return offline;
}

/** Anima .fade-in ao entrar na tela; reobserva quando o conteúdo muda. */
function useFadeIns(dep: unknown) {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.15 },
    );
    document.querySelectorAll('.fade-in').forEach((el) => {
      if (!el.classList.contains('is-visible')) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [dep]);
}

function CardBebida({ item, aoAdicionar, comDivisao }: { item: ProdutoMenu; aoAdicionar: (compartilhado: boolean) => void; comDivisao?: boolean }) {
  const [dividir, setDividir] = useState(false);
  return (
    <div className="card fade-in">
      <div className="card__header">
        <span className="card__name">{item.nome}</span>
        <span className="card__price">{formatarPreco(item.preco)}</span>
      </div>
      <p className="card__desc">{item.descricao}</p>
      {comDivisao && (
        <label className="card__compartilhado">
          <input type="checkbox" className="card__compartilhado-check" checked={dividir} onChange={(e) => setDividir(e.target.checked)} />
          Dividir entre a mesa
        </label>
      )}
      <button className="btn btn--add" onClick={() => aoAdicionar(comDivisao ? dividir : false)}>
        Adicionar
      </button>
    </div>
  );
}

export default function Cardapio() {
  const toast = useToast();
  const offline = useOffline();
  const [params] = useSearchParams();

  const mesaDaUrl = params.get('mesa') || '';
  const tokenMesa = params.get('t') || '';
  const temAcessoValido = Boolean(mesaDaUrl && tokenMesa);

  const [mesaInput, setMesaInput] = useState(mesaDaUrl);
  const [avisoMesa, setAvisoMesa] = useState(false);
  const mesaInputRef = useRef<HTMLInputElement>(null);
  const mesaAtual = mesaDaUrl || mesaInput.trim();

  const clienteId = useMemo(() => obterOuCriarClienteId(), []);
  const [clienteNome, setClienteNome] = useState(() => lerClienteNome());
  const [nomeAberto, setNomeAberto] = useState(false);

  const sessao = useSessao({ mesa: mesaAtual, tokenMesa, temAcessoValido });
  const liberada = sessao.tela === 'liberada';

  // Cardápio só carrega depois de confirmar que esta aba pode pedir.
  const [produtos, setProdutos] = useState<ProdutoMenu[]>([]);
  const [carregandoMenu, setCarregandoMenu] = useState(false);
  const [erroMenu, setErroMenu] = useState(false);

  async function carregarMenu() {
    setCarregandoMenu(true);
    setErroMenu(false);
    const { data, error } = await supabase.from('produtos').select('id, nome, descricao, preco, categoria').eq('ativo', true).order('ordem');
    if (error) {
      console.error('Erro ao carregar cardápio:', error);
      setErroMenu(true);
    } else {
      setProdutos(data as ProdutoMenu[]);
    }
    setCarregandoMenu(false);
  }

  useEffect(() => {
    if (!liberada) return;
    void carregarMenu();
    if (!clienteNome) setNomeAberto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liberada]);

  useFadeIns(produtos);

  const porCategoria = (c: Produto['categoria']) => produtos.filter((p) => p.categoria === c);

  // ---- carrinho ----
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [contaAberta, setContaAberta] = useState(false);

  useEffect(() => {
    if (!confirmado) return;
    const t = window.setTimeout(() => setConfirmado(false), 2800);
    return () => window.clearTimeout(t);
  }, [confirmado]);

  function exigirMesa(): string | null {
    const mesa = mesaInput.trim();
    if (!mesa) {
      setAvisoMesa(true);
      mesaInputRef.current?.focus();
      mesaInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    setAvisoMesa(false);
    return mesa;
  }

  function adicionar(p: ProdutoMenu, preco: number, compartilhado: boolean) {
    setCarrinho((c) => adicionarItem(c, p.id, p.nome, preco, compartilhado));
    setCarrinhoAberto(true);
  }

  async function fazerPedido() {
    const mesa = exigirMesa();
    if (!mesa) return;
    if (carrinho.length === 0) {
      toast('Adicione pelo menos um item antes de fazer o pedido.');
      return;
    }
    if (!clienteNome) {
      setNomeAberto(true);
      toast('Informe seu nome antes de fazer o pedido.');
      return;
    }

    setEnviando(true);
    const { error } = await supabase.rpc('criar_pedido', {
      p_mesa: Number(mesa),
      p_token: tokenMesa,
      p_itens: itensPayload(carrinho),
      p_cliente_nome: clienteNome,
      p_cliente_id: clienteId,
      p_token_sessao: sessao.tokenSessao,
    });
    setEnviando(false);

    if (!error) {
      setCarrinhoAberto(false);
      setConfirmado(true);
      setCarrinho([]);
      return;
    }

    console.error('Erro ao enviar pedido:', error);
    if (ehErroSessaoEncerrada(error)) {
      sessao.mostrarContaFechada(sessao.sessaoId); // carrinho fica como está
      return;
    }
    if (ehErroMesaBloqueada(error)) {
      sessao.mostrarMesaBloqueada();
      return;
    }
    // O carrinho é mantido de propósito — o cliente não perde o que já tinha escolhido.
    toast(error.message || 'O pedido NÃO foi enviado. Verifique sua conexão e tente de novo.');
  }

  function abrirConta() {
    if (exigirMesa()) setContaAberta(true);
  }

  const total = totalCarrinho(carrinho);

  return (
    <div className={offline ? 'is-offline' : undefined}>
      <div className={`offline-aviso${offline ? ' show' : ''}`} role="alert">
        Sem internet — seu pedido não será enviado.
      </div>

      <div className="mesa-bar">
        <label htmlFor="mesaInput">Número da mesa:</label>
        <input ref={mesaInputRef} type="number" id="mesaInput" min={1} placeholder="Ex: 5" required readOnly={Boolean(mesaDaUrl)} value={mesaInput} onChange={(e) => { setMesaInput(e.target.value); if (e.target.value.trim()) setAvisoMesa(false); }} />
        <span className={`mesa-bar__aviso${avisoMesa ? ' show' : ''}`}>Preencha o número da mesa antes de pedir!</span>
        <button type="button" className="mesa-bar__nome" onClick={() => setNomeAberto(true)}>
          👤 <span>{clienteNome || 'Identificar-se'}</span>
        </button>
      </div>

      <NomeModal
        aberto={nomeAberto}
        nomeAtual={clienteNome}
        onConfirmar={(nome) => {
          setClienteNome(nome);
          gravarClienteNome(nome);
          setNomeAberto(false);
        }}
        onCancelar={() => setNomeAberto(false)}
      />

      <header className="header">
        <nav className="nav container">
          <ul className="nav__links">
            <li><a href="#sobre">Sobre</a></li>
            <li><a href="#bebidas">Bebidas</a></li>
            <li><a href="#narguile">Narguile</a></li>
            <li><a href="#essencias">Essências</a></li>
            <li><a href="#contato">Contato</a></li>
          </ul>
        </nav>
      </header>

      <section className="hero">
        <div className="hero__bg"></div>
        <div className="hero__content container">
          <img src="/img/aooba_bar_fundo_escuro.svg" alt="AOOBA! BAR" className="hero__logo" />
          <p className="hero__subtitle">Drinks autorais, narguile de respeito e a melhor vibe da cidade.</p>
          <a href="#bebidas" className="btn btn--primary">Ver Cardápio</a>
        </div>
        <div className="hero__scroll"><span></span></div>
      </section>

      <section className="sobre container fade-in" id="sobre">
        <h2 className="section-title">O Point</h2>
        <p className="sobre__text">
          O AOOBA! BAR é o point perfeito pra quem curte um bom drink, um narguile caprichado e aquela vibe descontraída com os amigos.
          Ambiente aconchegante, luz baixa, música boa e um atendimento que trata todo mundo como de casa. Aqui o rolê começa cedo e não tem hora pra acabar.
        </p>
      </section>

      <section className="bebidas container" id="bebidas">
        <h2 className="section-title fade-in">Cardápio de Bebidas</h2>

        {carregandoMenu && <p className="cardapio-status">Carregando cardápio...</p>}
        {erroMenu && (
          <div className="cardapio-status cardapio-status--erro">
            <p>Não foi possível carregar o cardápio agora. Verifique sua conexão e tente de novo.</p>
            <button type="button" className="btn btn--secondary" onClick={() => void carregarMenu()}>Tentar novamente</button>
          </div>
        )}

        {([['drink', ' Drinks'], ['cerveja', ' Cervejas'], ['sem_alcool', ' Sem Álcool']] as const).map(([cat, titulo]) => (
          <div key={cat}>
            <h3 className="subsection-title fade-in">{titulo}</h3>
            <div className="cards-grid">
              {porCategoria(cat).map((p) => (
                <CardBebida key={p.id} item={p} aoAdicionar={(c) => adicionar(p, p.preco, c)} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="narguile container" id="narguile">
        <h2 className="section-title fade-in">Cardápio de Narguile</h2>
        <p className="narguile__intro fade-in">
          Nosso narguile é montado na hora, com carvão natural e essências premium Sence Hookah Tobacco. Escolha sua essência favorita e aproveite tragadas leves e saborosas.
        </p>
        <div className="cards-grid">
          {porCategoria('narguile').map((p) => (
            <CardBebida key={p.id} item={p} comDivisao aoAdicionar={(c) => adicionar(p, p.preco, c)} />
          ))}
        </div>
      </section>

      <section className="essencias container" id="essencias">
        <h2 className="section-title fade-in">Sence Hookah Tobacco</h2>
        <div className="essencias-grid">
          {porCategoria('essencia').map((p) => (
            <div className="essencia-card fade-in" key={p.id}>
              <p className="essencia-card__name">{p.nome}</p>
              <span className="essencia-card__tag">{p.descricao}</span>
              {/* Essências não têm preço próprio: entram no carrinho com preço 0. */}
              <button className="btn btn--add essencia-card__add" onClick={() => adicionar(p, 0, false)}>Adicionar</button>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer" id="contato">
        <div className="container footer__content">
          <img src="/img/aooba_bar_fundo_escuro.svg" alt="AOOBA! BAR" className="hero__logo" />
          <div className="footer__info">
            <p>📍 Rua 4. Chácara 1A, Lote 3</p>
            <p>🕒 Ter a Dom: 18h às 02h | Seg: Fechado</p>
          </div>
          <div className="footer__socials">
            <a href="https://www.instagram.com/aoba.bar?igsh=cnNzbjc2ejc2dWVi" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="social-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
                <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
              </svg>
            </a>
            <a href="https://wa.me/5511999999999" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="social-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.5 11.9c0 4.9-4 8.9-8.9 8.9-1.6 0-3.1-.4-4.4-1.2L3 21l1.5-4a8.9 8.9 0 0 1-1.2-4.4c0-4.9 4-8.9 8.9-8.9s8.9 4 8.9 8.9Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8.5 8.7c.1-.3.4-.5.7-.5h.8c.2 0 .4.1.5.4l.6 1.6c.1.2 0 .5-.1.6l-.5.5c-.2.2-.2.4-.1.6.4.7 1.5 1.8 2.2 2.2.2.1.4.1.6-.1l.5-.5c.2-.2.4-.2.6-.1l1.6.6c.2.1.4.3.4.5v.8c0 .3-.2.6-.5.7-.6.2-1.5.3-2.9-.3-1.6-.7-3.2-2.3-3.9-3.9-.6-1.4-.5-2.3-.3-2.9Z" fill="currentColor" />
              </svg>
            </a>
          </div>
          <p className="footer__copy">&copy; 2026 AOOBA! BAR. Todos os direitos reservados.</p>
        </div>
      </footer>

      {/* ===== CARRINHO ===== */}
      <div className={`cart-overlay${carrinhoAberto ? ' is-open' : ''}`} onClick={() => setCarrinhoAberto(false)} />
      <aside className={`cart-panel${carrinhoAberto ? ' is-open' : ''}`}>
        <div className="cart-panel__header">
          <span className="cart-panel__title">Seu Pedido</span>
          <button className="cart-panel__close" aria-label="Fechar carrinho" onClick={() => setCarrinhoAberto(false)}>&times;</button>
        </div>
        {carrinho.length === 0 && <p className="cart-panel__empty" style={{ display: 'block' }}>Seu carrinho está vazio.</p>}
        <div className="cart-panel__items">
          {carrinho.map((item) => (
            <div className="cart-item" key={`${item.produtoId}-${item.compartilhado}`}>
              <div className="cart-item__info">
                <span className="cart-item__nome">
                  {item.nome}
                  {item.compartilhado && <span className="cart-item__tag">Dividido</span>}
                </span>
                <span className="cart-item__preco">{formatarPreco(item.preco)}</span>
              </div>
              <div className="cart-item__controles">
                <button className="cart-item__btn" aria-label="Diminuir quantidade" onClick={() => setCarrinho((c) => alterarQuantidade(c, item.produtoId, item.compartilhado, -1))}>-</button>
                <span className="cart-item__qtd">{item.quantidade}</span>
                <button className="cart-item__btn" aria-label="Aumentar quantidade" onClick={() => setCarrinho((c) => alterarQuantidade(c, item.produtoId, item.compartilhado, 1))}>+</button>
                <button className="cart-item__remover" aria-label="Remover item" onClick={() => setCarrinho((c) => removerItem(c, item.produtoId, item.compartilhado))}>🗑</button>
              </div>
            </div>
          ))}
        </div>
        <div className="cart-panel__footer">
          <div className="cart-panel__total">
            <span>Total</span>
            <span>{formatarPreco(total)}</span>
          </div>
          <button className="btn btn--primary cart-panel__submit" disabled={enviando} onClick={() => void fazerPedido()}>
            {enviando ? 'Enviando...' : 'Fazer Pedido'}
          </button>
        </div>
      </aside>

      <button className="cart-fab" aria-label="Abrir carrinho" onClick={() => setCarrinhoAberto(true)}>
        🛒<span className="cart-fab__badge">{totalItens(carrinho)}</span>
      </button>

      <button className="fechar-conta-fab" onClick={abrirConta}>Fechar Conta</button>

      {contaAberta && (
        <ContaModal aberto={contaAberta} onFechar={() => setContaAberta(false)} mesa={mesaAtual} tokenMesa={tokenMesa} clienteId={clienteId} sessao={sessao} />
      )}

      <TravaModal sessao={sessao} mesa={mesaAtual} />

      <div className={`pedido-confirmado-overlay${confirmado ? ' show' : ''}`} onClick={() => setConfirmado(false)}>
        <div className="pedido-confirmado-card">
          <span className="pedido-confirmado-icone" aria-hidden="true">✓</span>
          <p className="pedido-confirmado-texto">Pedido enviado! O garçom já foi avisado.</p>
        </div>
      </div>
    </div>
  );
}
