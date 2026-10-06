import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { lerQrDaMesa } from '../model/qr';
import { CardapioScreen } from '../view/CardapioScreen';
import { TravaView } from '../view/TravaView';

/** Rota `/cardapio?mesa=N&t=TOKEN` — vem do scanner ou do link `aooba://cardapio?...`. */
export default function Cardapio() {
  const router = useRouter();
  const { mesa, t } = useLocalSearchParams<{ mesa?: string; t?: string }>();
  const acesso = useMemo(() => lerQrDaMesa(`?mesa=${encodeURIComponent(mesa ?? '')}&t=${encodeURIComponent(t ?? '')}`), [mesa, t]);
  const voltar = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!acesso) return <TravaVazia aoEscanear={voltar} />;
  // `key` garante ViewModels novos se outra mesa for aberta na mesma tela.
  return <CardapioScreen key={`${acesso.mesa}:${acesso.token}`} acesso={acesso} aoEscanearDeNovo={voltar} />;
}

/** Link sem mesa/token válidos: não há o que carregar, só pedir um novo scan. */
function TravaVazia({ aoEscanear }: { aoEscanear: () => void }) {
  const nada = () => {};
  return <TravaView tela="qr_invalido" abrindo={false} mesa={0} acoes={{ iniciarPedido: nada, entrarNaConta: nada, cancelarEntrada: nada, tentarDeNovo: nada }} aoEscanearDeNovo={aoEscanear} />;
}
