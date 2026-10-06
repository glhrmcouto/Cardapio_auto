import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { formatarPreco, STATUS_LABEL_PESSOA } from '../model/formatar';
import type { MinhaParte } from '../model/types';
import type { CardapioViewModel, EstadoCardapio } from '../viewmodel/CardapioViewModel';
import { NOME_MAX } from '../viewmodel/CardapioViewModel';
import type { ContaViewModel, EstadoConta } from '../viewmodel/ContaViewModel';
import { Botao } from './components/Botao';
import { Painel } from './components/Painel';
import { cores, raio } from './theme';

// ---------------------------------------------------------------- nome

export function NomePainel({ vm, estado }: { vm: CardapioViewModel; estado: EstadoCardapio }) {
  const [valor, setValor] = useState(estado.clienteNome);
  const [aviso, setAviso] = useState(false);

  useEffect(() => {
    if (estado.nomeAberto) {
      setValor(estado.clienteNome);
      setAviso(false);
    }
  }, [estado.nomeAberto, estado.clienteNome]);

  async function confirmar() {
    if (!(await vm.confirmarNome(valor))) setAviso(true);
  }

  return (
    <Painel visivel={estado.nomeAberto} titulo="Como podemos te chamar?" onFechar={estado.clienteNome ? () => vm.fecharNome() : undefined}>
      <Text style={estilos.texto}>Um nome ou apelido curto ajuda a gente a saber de quem é cada pedido na mesa.</Text>
      <TextInput
        style={estilos.input}
        value={valor}
        onChangeText={(t) => {
          setValor(t);
          if (t.trim()) setAviso(false);
        }}
        maxLength={NOME_MAX}
        placeholder="Ex: João"
        placeholderTextColor={cores.cinzaEscuro}
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void confirmar()}
        accessibilityLabel="Seu nome ou apelido"
      />
      {aviso && <Text style={estilos.erro}>Digite um nome pra continuar.</Text>}
      <View style={estilos.linhaBotoes}>
        {estado.clienteNome ? <Botao titulo="Cancelar" variante="secundario" onPress={() => vm.fecharNome()} estilo={estilos.flex} /> : null}
        <Botao titulo="Confirmar" onPress={() => void confirmar()} estilo={estilos.flex} />
      </View>
    </Painel>
  );
}

// ------------------------------------------------------------ carrinho

export function CarrinhoPainel({ vm, estado }: { vm: CardapioViewModel; estado: EstadoCardapio }) {
  return (
    <Painel visivel={estado.carrinhoAberto} titulo="Seu Pedido" onFechar={() => vm.fecharCarrinho()}>
      {estado.carrinho.length === 0 && <Text style={estilos.vazio}>Seu carrinho está vazio.</Text>}
      {estado.carrinho.map((item) => (
        <View key={`${item.produtoId}-${item.compartilhado}`} style={estilos.itemCarrinho}>
          <View style={estilos.flex}>
            <Text style={estilos.nomeItem}>
              {item.nome}
              {item.compartilhado ? '  · Dividido' : ''}
            </Text>
            <Text style={estilos.precoItem}>{formatarPreco(item.preco)}</Text>
          </View>
          <View style={estilos.controles}>
            <Pressable style={estilos.btnQtd} accessibilityLabel="Diminuir quantidade" onPress={() => vm.alterarQuantidade(item, -1)}>
              <Text style={estilos.btnQtdTexto}>−</Text>
            </Pressable>
            <Text style={estilos.qtd}>{item.quantidade}</Text>
            <Pressable style={estilos.btnQtd} accessibilityLabel="Aumentar quantidade" onPress={() => vm.alterarQuantidade(item, 1)}>
              <Text style={estilos.btnQtdTexto}>+</Text>
            </Pressable>
            <Pressable hitSlop={8} accessibilityLabel="Remover item" onPress={() => vm.remover(item)}>
              <Text style={estilos.lixeira}>🗑</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <View style={estilos.totalLinha}>
        <Text style={estilos.totalTexto}>Total</Text>
        <Text style={estilos.totalTexto}>{formatarPreco(vm.total)}</Text>
      </View>
      <Botao titulo="Fazer Pedido" carregando={estado.enviando} onPress={() => void vm.fazerPedido()} />
    </Painel>
  );
}

// --------------------------------------------------------------- conta

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <View style={estilos.totalLinha}>
      <Text style={destaque ? estilos.totalTexto : estilos.texto}>{rotulo}</Text>
      <Text style={destaque ? estilos.totalTexto : estilos.texto}>{valor}</Text>
    </View>
  );
}

function MinhaParteSecao({ minha, pct, vm, estado }: { minha: MinhaParte; pct: number; vm: ContaViewModel; estado: EstadoConta }) {
  const semNada = minha.itens_diretos.length === 0 && minha.itens_compartilhados.length === 0;
  const previa = vm.previaMinhaParte;

  function confirmarFechamento() {
    Alert.alert('Fechar minha parte', `Fechar sua parte no valor de ${formatarPreco(previa.total)}${estado.aceitaTaxa ? '' : ' (sem taxa de serviço)'}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Fechar', onPress: () => void vm.fecharMinhaParte() },
    ]);
  }

  return (
    <View style={estilos.secao}>
      <Text style={estilos.secaoTitulo}>Minha parte</Text>
      {semNada ? (
        <Text style={estilos.vazio}>Você ainda não pediu nada nessa mesa.</Text>
      ) : (
        <>
          {minha.itens_diretos.map((item, i) => (
            <Linha key={`d${i}`} rotulo={`${item.quantidade}x ${item.nome}${item.pago ? '  ✓ pago' : ''}`} valor={formatarPreco(item.preco * item.quantidade)} />
          ))}
          {minha.itens_compartilhados.map((item, i) => (
            <Linha key={`c${i}`} rotulo={`${item.nome} (fração compartilhada)${item.pago ? '  ✓ pago' : ''}`} valor={formatarPreco(item.valor)} />
          ))}

          {minha.status === 'em_aberto' && (
            <View style={estilos.caixa}>
              <View style={estilos.switchLinha}>
                <Text style={estilos.texto}>Incluir {pct}% de serviço</Text>
                <Switch value={estado.aceitaTaxa} onValueChange={(v) => vm.definirAceitaTaxa(v)} trackColor={{ true: cores.laranja, false: cores.borda }} />
              </View>
              <Linha rotulo="Subtotal" valor={formatarPreco(previa.subtotal)} />
              <Linha rotulo="Serviço" valor={formatarPreco(previa.taxa)} />
              <Linha rotulo="Total" valor={formatarPreco(previa.total)} destaque />
              <Botao titulo="Fechar minha parte" carregando={estado.fechandoParte} onPress={confirmarFechamento} />
            </View>
          )}

          {minha.status === 'aguardando' && (
            <View style={estilos.caixa}>
              <Text style={estilos.texto}>Sua parte foi enviada ao balcão. Aguarde o garçom.</Text>
              <Linha rotulo="Subtotal" valor={formatarPreco(minha.subtotal_aguardando)} />
              <Linha rotulo="Serviço" valor={formatarPreco(minha.taxa_aguardando)} />
              <Linha rotulo="Total" valor={formatarPreco(minha.total_aguardando)} destaque />
            </View>
          )}

          {minha.status === 'pago' && (
            <View style={estilos.caixa}>
              <Text style={[estilos.texto, { color: cores.ok }]}>Você já pagou sua parte.</Text>
              <Linha rotulo="Subtotal" valor={formatarPreco(minha.subtotal_pago)} />
              <Linha rotulo="Serviço" valor={formatarPreco(minha.taxa_pago)} />
              <Linha rotulo="Total" valor={formatarPreco(minha.total_pago)} destaque />
            </View>
          )}
        </>
      )}
    </View>
  );
}

export function ContaPainel({ vm, estado, mesa }: { vm: ContaViewModel; estado: EstadoConta; mesa: number }) {
  const { conta } = estado;
  return (
    <Painel visivel={estado.aberta} titulo={`Conta — Mesa ${mesa}`} onFechar={() => vm.fechar()} aviso={estado.aviso}>
      {estado.status && <Text style={estilos.vazio}>{estado.status}</Text>}
      {estado.status && !conta && estado.status !== 'Consultando conta...' && <Botao titulo="Tentar de novo" variante="secundario" onPress={() => void vm.carregar()} />}

      {conta && (
        <>
          <MinhaParteSecao minha={conta.minha_parte} pct={conta.taxa_servico_percentual} vm={vm} estado={estado} />

          <View style={estilos.secao}>
            <Text style={estilos.secaoTitulo}>Conta da mesa</Text>
            {(!conta.itens || conta.itens.length === 0) && <Text style={estilos.vazio}>Nenhum pedido registrado para essa mesa.</Text>}
            {conta.itens?.map((item, i) => (
              <Linha key={i} rotulo={`${item.quantidade}x ${item.nome}`} valor={formatarPreco(item.preco * item.quantidade)} />
            ))}
            <View style={estilos.caixa}>
              <Linha rotulo="Subtotal" valor={formatarPreco(conta.subtotal)} />
              <Linha rotulo={`Serviço (${conta.taxa_servico_percentual}%)`} valor={formatarPreco(conta.taxa_servico)} />
              <Linha rotulo="Total geral" valor={formatarPreco(conta.total_geral)} />
              <Linha rotulo="Já pago / aguardando confirmação" valor={formatarPreco(conta.total_pago + conta.total_pendente_confirmacao)} />
              <Linha rotulo="Saldo restante" valor={formatarPreco(conta.saldo_restante)} destaque />
            </View>
            {conta.por_pessoa.map((p, i) => (
              <View key={i} style={estilos.pessoa}>
                <View style={estilos.totalLinha}>
                  <Text style={estilos.nomeItem}>
                    {p.nome} · <Text style={estilos.status}>{STATUS_LABEL_PESSOA[p.status] ?? p.status}</Text>
                  </Text>
                  <Text style={estilos.nomeItem}>{formatarPreco(p.valor)}</Text>
                </View>
                <Text style={estilos.detalhe}>
                  Subtotal {formatarPreco(p.subtotal)} + Serviço {formatarPreco(p.taxa_servico)}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      <View style={estilos.linhaBotoes}>
        <Botao titulo="Cancelar" variante="secundario" onPress={() => vm.fechar()} estilo={estilos.flex} />
        <Botao titulo="Fechar a conta toda" carregando={estado.fechandoConta} onPress={() => void vm.fecharContaToda()} estilo={estilos.flex} />
      </View>
    </Painel>
  );
}

const estilos = StyleSheet.create({
  flex: { flex: 1 },
  texto: { color: cores.cinza, fontSize: 15, flexShrink: 1 },
  vazio: { color: cores.cinzaEscuro, fontSize: 15, textAlign: 'center', paddingVertical: 8 },
  erro: { color: cores.erro, fontSize: 13 },
  input: { backgroundColor: cores.preto, borderColor: cores.borda, borderWidth: 1, borderRadius: raio.md, color: cores.branco, paddingHorizontal: 12, height: 48, fontSize: 16 },
  linhaBotoes: { flexDirection: 'row', gap: 12, marginTop: 4 },
  itemCarrinho: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: cores.borda },
  nomeItem: { color: cores.branco, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  precoItem: { color: cores.salmao, fontSize: 14 },
  controles: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnQtd: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: cores.laranja, alignItems: 'center', justifyContent: 'center' },
  btnQtdTexto: { color: cores.laranja, fontSize: 20, lineHeight: 22 },
  qtd: { color: cores.branco, minWidth: 18, textAlign: 'center', fontWeight: '700' },
  lixeira: { fontSize: 18, marginLeft: 4 },
  totalLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  totalTexto: { color: cores.branco, fontSize: 17, fontWeight: '700' },
  secao: { gap: 8 },
  secaoTitulo: { color: cores.salmao, fontSize: 17, fontWeight: '700' },
  caixa: { backgroundColor: cores.preto, borderRadius: raio.md, padding: 12, gap: 8 },
  switchLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pessoa: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: cores.borda },
  status: { color: cores.laranja, fontSize: 13, fontWeight: '600' },
  detalhe: { color: cores.cinzaEscuro, fontSize: 12 },
});
