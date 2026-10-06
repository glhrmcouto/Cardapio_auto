import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, armazenamento } from '../composicao';
import { formatarPreco, LABEL_CATEGORIA, ORDEM_CATEGORIAS } from '../model/formatar';
import type { AcessoMesa, ProdutoMenu } from '../model/types';
import { CardapioViewModel } from '../viewmodel/CardapioViewModel';
import { ContaViewModel } from '../viewmodel/ContaViewModel';
import { SessaoViewModel } from '../viewmodel/SessaoViewModel';
import { useViewModel, useViewModelState } from '../viewmodel/useViewModel';
import { Aviso } from './components/Aviso';
import { Botao } from './components/Botao';
import { CarrinhoPainel, ContaPainel, NomePainel } from './paineis';
import { cores, raio } from './theme';
import { TravaView } from './TravaView';

function ProdutoItem({ produto, aoAdicionar }: { produto: ProdutoMenu; aoAdicionar: (compartilhado: boolean) => void }) {
  const [dividir, setDividir] = useState(false);
  const ehEssencia = produto.categoria === 'essencia';
  return (
    <View style={estilos.card}>
      <View style={estilos.cardTopo}>
        <Text style={estilos.cardNome}>{produto.nome}</Text>
        {!ehEssencia && <Text style={estilos.cardPreco}>{formatarPreco(produto.preco)}</Text>}
      </View>
      {!!produto.descricao && <Text style={estilos.cardDesc}>{produto.descricao}</Text>}
      {produto.categoria === 'narguile' && (
        <View style={estilos.dividir}>
          <Text style={estilos.cardDesc}>Dividir entre a mesa</Text>
          <Switch value={dividir} onValueChange={setDividir} trackColor={{ true: cores.laranja, false: cores.borda }} />
        </View>
      )}
      <Botao titulo="Adicionar" onPress={() => aoAdicionar(dividir)} estilo={estilos.btnAdicionar} />
    </View>
  );
}

interface Props {
  acesso: AcessoMesa;
  aoEscanearDeNovo: () => void;
}

export function CardapioScreen({ acesso, aoEscanearDeNovo }: Props) {
  // MVVM: a View só lê estado e chama métodos; toda a lógica está nos ViewModels.
  const sessaoVm = useViewModel(() => new SessaoViewModel(acesso, api, armazenamento));
  const cardapioVm = useViewModel(() => new CardapioViewModel(acesso, api, armazenamento, sessaoVm));
  const contaVm = useViewModel(() => new ContaViewModel(acesso, api, sessaoVm, () => cardapioVm.clienteId()));

  const sessao = useViewModelState(sessaoVm);
  const cardapio = useViewModelState(cardapioVm);
  const conta = useViewModelState(contaVm);

  // O QR foi lido agora: começo explícito.
  useEffect(() => {
    void sessaoVm.iniciar('scan');
  }, [sessaoVm]);

  const liberada = sessao.tela === 'liberada';

  // O cardápio só carrega depois de confirmar que este aparelho pode pedir.
  useEffect(() => {
    if (sessao.sessaoId) void cardapioVm.aoLiberar();
  }, [sessao.sessaoId, cardapioVm]);

  // Se a sessão travou (conta fechada, mesa bloqueada...), fecha o que estiver aberto por cima.
  useEffect(() => {
    if (!liberada) {
      contaVm.fechar();
      cardapioVm.fecharCarrinho();
    }
  }, [liberada, contaVm, cardapioVm]);

  const secoes = useMemo(
    () =>
      ORDEM_CATEGORIAS.map((c) => ({ categoria: c, title: LABEL_CATEGORIA[c], data: cardapio.produtos.filter((p) => p.categoria === c) })).filter((s) => s.data.length > 0),
    [cardapio.produtos],
  );

  useEffect(() => {
    if (!cardapio.confirmado) return;
    const t = setTimeout(() => cardapioVm.dispensarConfirmacao(), 2800);
    return () => clearTimeout(t);
  }, [cardapio.confirmado, cardapioVm]);

  const acoesTrava = {
    iniciarPedido: () => void sessaoVm.iniciarPedido(),
    entrarNaConta: () => void sessaoVm.entrarNaSessao(),
    cancelarEntrada: () => void sessaoVm.cancelarEntrada(),
    tentarDeNovo: () => void sessaoVm.iniciar('scan'),
  };

  if (!liberada) {
    return (
      <>
        <TravaView tela={sessao.tela} abrindo={sessao.abrindo} mesa={acesso.mesa} acoes={acoesTrava} aoEscanearDeNovo={aoEscanearDeNovo} />
        <Aviso aviso={sessao.aviso} />
      </>
    );
  }

  return (
    <SafeAreaView style={estilos.raiz} edges={['top', 'left', 'right']}>
      <View style={estilos.topo}>
        <Text style={estilos.mesa}>Mesa {acesso.mesa}</Text>
        <Pressable onPress={() => cardapioVm.abrirNome()} accessibilityLabel="Alterar nome" style={estilos.nome}>
          <Text style={estilos.nomeTexto}>👤 {cardapio.clienteNome || 'Identificar-se'}</Text>
        </Pressable>
      </View>

      {cardapio.carregandoMenu && cardapio.produtos.length === 0 && (
        <View style={estilos.status}>
          <ActivityIndicator color={cores.laranja} />
          <Text style={estilos.statusTexto}>Carregando cardápio…</Text>
        </View>
      )}

      {cardapio.erroMenu && (
        <View style={estilos.status}>
          <Text style={[estilos.statusTexto, { color: cores.erro }]}>Não foi possível carregar o cardápio agora. Verifique sua conexão e tente de novo.</Text>
          <Botao titulo="Tentar novamente" variante="secundario" onPress={() => void cardapioVm.carregarMenu()} />
        </View>
      )}

      <SectionList
        sections={secoes}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={estilos.lista}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={estilos.secao}>{section.title}</Text>}
        renderItem={({ item }) => <ProdutoItem produto={item} aoAdicionar={(c) => cardapioVm.adicionar(item, c)} />}
        ListFooterComponent={
          <View style={estilos.rodape}>
            <Text style={estilos.rodapeTexto}>📍 Rua 4. Chácara 1A, Lote 3</Text>
            <Text style={estilos.rodapeTexto}>🕒 Ter a Dom: 18h às 02h | Seg: Fechado</Text>
          </View>
        }
      />

      <View style={estilos.barra}>
        <Botao titulo="Fechar Conta" variante="secundario" estilo={estilos.flex} onPress={() => void contaVm.abrir()} />
        <Botao titulo={`🛒 Carrinho (${cardapioVm.quantidadeTotal})`} estilo={estilos.flex} onPress={() => cardapioVm.abrirCarrinho()} />
      </View>

      {cardapio.confirmado && (
        <Pressable style={estilos.confirmado} onPress={() => cardapioVm.dispensarConfirmacao()} accessibilityRole="alert">
          <Text style={estilos.confirmadoIcone}>✓</Text>
          <Text style={estilos.confirmadoTexto}>Pedido enviado! O garçom já foi avisado.</Text>
        </Pressable>
      )}

      <NomePainel vm={cardapioVm} estado={cardapio} />
      <CarrinhoPainel vm={cardapioVm} estado={cardapio} />
      <ContaPainel vm={contaVm} estado={conta} mesa={acesso.mesa} />
      <Aviso aviso={cardapio.aviso ?? sessao.aviso} />
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: cores.preto },
  flex: { flex: 1 },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: cores.borda },
  mesa: { color: cores.laranja, fontSize: 20, fontWeight: '800' },
  nome: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: raio.lg, borderWidth: 1, borderColor: cores.borda },
  nomeTexto: { color: cores.branco, fontSize: 14 },
  status: { padding: 16, gap: 12, alignItems: 'center' },
  statusTexto: { color: cores.cinza, textAlign: 'center' },
  lista: { paddingHorizontal: 16, paddingBottom: 110 },
  secao: { color: cores.salmao, fontSize: 22, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: cores.preto2, borderRadius: raio.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: cores.borda, gap: 6 },
  cardTopo: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardNome: { color: cores.branco, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  cardPreco: { color: cores.laranja, fontSize: 17, fontWeight: '700' },
  cardDesc: { color: cores.cinza, fontSize: 14 },
  dividir: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  btnAdicionar: { minHeight: 40, marginTop: 4 },
  rodape: { marginTop: 28, alignItems: 'center', gap: 4 },
  rodapeTexto: { color: cores.cinzaEscuro, fontSize: 13 },
  barra: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, padding: 12, backgroundColor: cores.preto, borderTopWidth: 1, borderTopColor: cores.borda },
  confirmado: { position: 'absolute', top: '35%', alignSelf: 'center', backgroundColor: cores.preto2, borderColor: cores.ok, borderWidth: 2, borderRadius: raio.lg, padding: 24, alignItems: 'center', gap: 8, maxWidth: '80%' },
  confirmadoIcone: { color: cores.ok, fontSize: 44, fontWeight: '800' },
  confirmadoTexto: { color: cores.branco, fontSize: 16, textAlign: 'center' },
});
