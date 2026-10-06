import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { cores, raio } from '../theme';

interface Props {
  titulo: string;
  onPress: () => void;
  variante?: 'primario' | 'secundario';
  desabilitado?: boolean;
  carregando?: boolean;
  estilo?: StyleProp<ViewStyle>;
}

export function Botao({ titulo, onPress, variante = 'primario', desabilitado, carregando, estilo }: Props) {
  const primario = variante === 'primario';
  const bloqueado = desabilitado || carregando;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!bloqueado }}
      disabled={bloqueado}
      onPress={onPress}
      style={({ pressed }) => [estilos.base, primario ? estilos.primario : estilos.secundario, bloqueado && estilos.bloqueado, pressed && estilos.pressionado, estilo]}
    >
      {carregando ? <ActivityIndicator color={primario ? cores.preto : cores.laranja} /> : <Text style={[estilos.texto, !primario && estilos.textoSecundario]}>{titulo}</Text>}
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  base: { minHeight: 48, borderRadius: raio.lg, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  primario: { backgroundColor: cores.laranja },
  secundario: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: cores.laranja },
  bloqueado: { opacity: 0.5 },
  pressionado: { opacity: 0.8 },
  texto: { color: cores.preto, fontWeight: '700', fontSize: 16 },
  textoSecundario: { color: cores.laranja },
});
