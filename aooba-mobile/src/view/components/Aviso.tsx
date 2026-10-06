import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../theme';

/** Toast: mostra `aviso.texto` por alguns segundos sempre que `aviso.id` muda. */
export function Aviso({ aviso }: { aviso: { id: number; texto: string } | null }) {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!aviso) return;
    setVisivel(true);
    const t = setTimeout(() => setVisivel(false), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  if (!aviso || !visivel) return null;
  return (
    <View pointerEvents="none" style={estilos.area}>
      <View style={estilos.caixa} accessibilityLiveRegion="polite">
        <Text style={estilos.texto}>{aviso.texto}</Text>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  area: { position: 'absolute', left: 16, right: 16, bottom: 96, alignItems: 'center', zIndex: 100, elevation: 100 },
  caixa: { backgroundColor: cores.branco, borderRadius: raio.md, paddingVertical: 12, paddingHorizontal: 16 },
  texto: { color: cores.preto, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
