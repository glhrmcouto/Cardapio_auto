import { useEffect, useState } from 'react';

export interface FeedbackMsg {
  texto: string;
  tipo: 'sucesso' | 'erro';
}

/** Estado de mensagem que some sozinha depois de 4s (.admin-produto-card__feedback). */
export function useFeedback() {
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 4000);
    return () => window.clearTimeout(t);
  }, [msg]);

  return [msg, setMsg] as const;
}

export function FeedbackLinha({ msg }: { msg: FeedbackMsg | null }) {
  const classe = msg ? ` admin-produto-card__feedback--${msg.tipo}` : '';
  return (
    <p className={`admin-produto-card__feedback${classe}`} role="status">
      {msg?.texto}
    </p>
  );
}

export function StatusCarregando({
  carregando,
  erro,
  textoCarregando,
  textoErro,
  aoTentar,
}: {
  carregando: boolean;
  erro: boolean;
  textoCarregando: string;
  textoErro: string;
  aoTentar: () => void;
}) {
  if (carregando) return <p className="cardapio-status">{textoCarregando}</p>;
  if (erro)
    return (
      <div className="cardapio-status cardapio-status--erro">
        <p>{textoErro}</p>
        <button type="button" className="btn btn--secondary" onClick={aoTentar}>
          Tentar novamente
        </button>
      </div>
    );
  return null;
}
