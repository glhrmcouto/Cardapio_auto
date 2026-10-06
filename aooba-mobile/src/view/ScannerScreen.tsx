import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lerQrDaMesa } from '../model/qr';
import type { AcessoMesa } from '../model/types';
import { Botao } from './components/Botao';
import { cores, raio } from './theme';

interface Props {
  aoLerMesa: (acesso: AcessoMesa) => void;
}

/** Entrada do app: lê o QR da mesa. Sem câmera (ou no emulador) dá para colar o link da mesa. */
export function ScannerScreen({ aoLerMesa }: Props) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [erro, setErro] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const travado = useRef(false); // a câmera dispara várias leituras do mesmo QR

  function aoEscanear(conteudo: string) {
    if (travado.current) return;
    const acesso = lerQrDaMesa(conteudo);
    if (!acesso) {
      setErro('Esse QR code não é de uma mesa do AOOBA! BAR.');
      return;
    }
    travado.current = true;
    setErro(null);
    aoLerMesa(acesso);
    setTimeout(() => (travado.current = false), 1500);
  }

  function usarLink() {
    const acesso = lerQrDaMesa(link);
    if (!acesso) {
      setErro('Link inválido. Cole o endereço completo do QR da mesa.');
      return;
    }
    setErro(null);
    aoLerMesa(acesso);
  }

  return (
    <SafeAreaView style={estilos.raiz}>
      <Text style={estilos.marca}>AOOBA! BAR</Text>
      <Text style={estilos.subtitulo}>Aponte a câmera para o QR code da sua mesa</Text>

      <View style={estilos.camera}>
        {permissao?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => aoEscanear(data)}
          />
        ) : (
          <View style={estilos.semCamera}>
            <Text style={estilos.texto}>
              {permissao && !permissao.canAskAgain ? 'A permissão da câmera está bloqueada. Libere nas configurações do aparelho ou cole o link abaixo.' : 'Precisamos da câmera para ler o QR code da mesa.'}
            </Text>
            {(!permissao || permissao.canAskAgain) && <Botao titulo="Permitir câmera" onPress={() => void pedirPermissao()} />}
          </View>
        )}
      </View>

      {erro && (
        <Text style={estilos.erro} accessibilityRole="alert">
          {erro}
        </Text>
      )}

      <View style={estilos.manual}>
        <Text style={estilos.rotulo}>Sem câmera? Cole o link da mesa</Text>
        <TextInput
          style={estilos.input}
          value={link}
          onChangeText={setLink}
          placeholder="https://…/?mesa=5&t=…"
          placeholderTextColor={cores.cinzaEscuro}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={usarLink}
          returnKeyType="go"
        />
        <Botao titulo="Abrir cardápio" variante="secundario" onPress={usarLink} desabilitado={!link.trim()} />
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: cores.preto, padding: 16, gap: 12 },
  marca: { color: cores.laranja, fontSize: 32, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  subtitulo: { color: cores.cinza, textAlign: 'center', fontSize: 15 },
  camera: { flex: 1, minHeight: 220, borderRadius: raio.lg, overflow: 'hidden', backgroundColor: cores.preto2, borderWidth: 1, borderColor: cores.borda },
  semCamera: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16 },
  texto: { color: cores.cinza, textAlign: 'center', fontSize: 15 },
  erro: { color: cores.erro, textAlign: 'center' },
  manual: { gap: 8 },
  rotulo: { color: cores.cinza, fontSize: 13 },
  input: { backgroundColor: cores.preto2, borderColor: cores.borda, borderWidth: 1, borderRadius: raio.md, color: cores.branco, paddingHorizontal: 12, height: 46 },
});
