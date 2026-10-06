import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TelaSessao } from '../viewmodel/SessaoViewModel';
import { Botao } from './components/Botao';
import { cores } from './theme';

interface Conteudo {
  titulo: string;
  texto: string;
}

function conteudoDaTela(tela: TelaSessao, mesa: number): Conteudo | null {
  switch (tela) {
    case 'sem_conexao':
      return { titulo: 'Sem conexão', texto: 'Não conseguimos confirmar sua mesa agora. Verifique a internet e tente de novo.' };
    case 'qr_invalido':
      return { titulo: 'QR code inválido', texto: 'Esse QR code não é válido para uma mesa ativa. Escaneie o QR code da mesa novamente.' };
    case 'boas_vindas':
      return { titulo: 'Bem-vindo ao AOOBA! BAR', texto: `Toque abaixo para iniciar seu pedido na Mesa ${mesa}.` };
    case 'conta_encerrada':
      return { titulo: 'Conta encerrada', texto: 'Obrigado pela visita! 🧡 Foi um prazer ter você no AOOBA! BAR. Para um novo pedido, escaneie o QR code da mesa de novo.' };
    case 'confirmar_entrada':
      return { titulo: `Mesa ${mesa} com conta aberta`, texto: `A Mesa ${mesa} já tem uma conta aberta. Deseja entrar nela para pedir junto?` };
    case 'entrada_cancelada':
      return { titulo: 'Tudo bem', texto: `Se quiser pedir na Mesa ${mesa}, escaneie o QR code da mesa novamente.` };
    case 'mesa_bloqueada':
      return { titulo: 'Mesa aguardando liberação', texto: 'Chame um atendente para liberar o pedido nesta mesa. Esta tela atualiza sozinha.' };
    default:
      return null; // 'carregando' e 'liberada' não têm texto
  }
}

export interface AcoesTrava {
  iniciarPedido: () => void;
  entrarNaConta: () => void;
  cancelarEntrada: () => void;
  tentarDeNovo: () => void;
}

interface Props {
  tela: TelaSessao;
  abrindo: boolean;
  mesa: number;
  acoes: AcoesTrava;
  aoEscanearDeNovo: () => void;
}

/** Tudo que bloqueia o cardápio. O cardápio só aparece quando a tela é 'liberada'. */
export function TravaView({ tela, abrindo, mesa, acoes, aoEscanearDeNovo }: Props) {
  if (tela === 'carregando') {
    return (
      <View style={estilos.centro}>
        <ActivityIndicator size="large" color={cores.laranja} />
        <Text style={estilos.texto}>Conferindo sua mesa…</Text>
      </View>
    );
  }

  const conteudo = conteudoDaTela(tela, mesa);
  if (!conteudo) return null;

  return (
    <SafeAreaView style={estilos.centro}>
      <Text style={estilos.titulo} accessibilityRole="header">
        {conteudo.titulo}
      </Text>
      <Text style={estilos.texto}>{conteudo.texto}</Text>

      <View style={estilos.acoes}>
        {tela === 'boas_vindas' && <Botao titulo="Iniciar pedido" carregando={abrindo} onPress={acoes.iniciarPedido} />}
        {tela === 'confirmar_entrada' && (
          <>
            <Botao titulo="Entrar na conta" onPress={acoes.entrarNaConta} />
            <Botao titulo="Cancelar" variante="secundario" onPress={acoes.cancelarEntrada} />
          </>
        )}
        {tela === 'sem_conexao' && <Botao titulo="Tentar de novo" onPress={acoes.tentarDeNovo} />}
        {tela !== 'boas_vindas' && tela !== 'confirmar_entrada' && tela !== 'mesa_bloqueada' && (
          <Botao titulo="Escanear QR code" variante={tela === 'sem_conexao' ? 'secundario' : 'primario'} onPress={aoEscanearDeNovo} />
        )}
        {(tela === 'boas_vindas' || tela === 'mesa_bloqueada') && <Botao titulo="Escanear outra mesa" variante="secundario" onPress={aoEscanearDeNovo} />}
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  centro: { flex: 1, backgroundColor: cores.preto, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  titulo: { color: cores.laranja, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  texto: { color: cores.cinza, fontSize: 16, textAlign: 'center', lineHeight: 23 },
  acoes: { alignSelf: 'stretch', gap: 12, marginTop: 8 },
});
