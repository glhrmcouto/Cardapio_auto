import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../theme';
import { Aviso } from './Aviso';

interface Props {
  visivel: boolean;
  titulo: string;
  /** Sem `onFechar` o painel é de trava: não fecha ao tocar fora nem pelo botão voltar. */
  onFechar?: () => void;
  /** Toast dentro do painel (o Modal cobre o toast da tela principal). */
  aviso?: { id: number; texto: string } | null;
  children: ReactNode;
}

/** Painel que sobe de baixo (equivale aos .modal-panel do site). */
export function Painel({ visivel, titulo, onFechar, aviso = null, children }: Props) {
  return (
    <Modal visible={visivel} transparent animationType="slide" onRequestClose={onFechar}>
      <KeyboardAvoidingView style={estilos.raiz} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={estilos.fundo} onPress={onFechar} accessibilityLabel="Fechar" />
        <View style={estilos.painel}>
          <View style={estilos.cabecalho}>
            <Text style={estilos.titulo} accessibilityRole="header">
              {titulo}
            </Text>
            {onFechar && (
              <Pressable onPress={onFechar} accessibilityLabel="Fechar" hitSlop={12}>
                <Text style={estilos.fechar}>×</Text>
              </Pressable>
            )}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={estilos.conteudo}>
            {children}
          </ScrollView>
        </View>
        <Aviso aviso={aviso} />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, justifyContent: 'flex-end' },
  fundo: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.7)' },
  painel: { backgroundColor: cores.preto2, borderTopLeftRadius: raio.lg, borderTopRightRadius: raio.lg, maxHeight: '88%', borderTopWidth: 1, borderColor: cores.borda },
  cabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  titulo: { color: cores.laranja, fontSize: 20, fontWeight: '700', flexShrink: 1 },
  fechar: { color: cores.branco, fontSize: 30, lineHeight: 30 },
  conteudo: { padding: 16, paddingTop: 8, paddingBottom: 28, gap: 12 },
});
