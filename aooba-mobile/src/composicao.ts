import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { AooobaApi } from './model/api';
import { ArmazenamentoLocal, type KeyValueStore } from './model/armazenamento';

// Raiz de composição: único lugar que escolhe as implementações reais (rede e armazenamento do aparelho).
// Celular físico: use o IP da máquina na rede (ex.: http://192.168.0.10:3333). Emulador Android: http://10.0.2.2:3333.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3333';

const store: KeyValueStore = {
  get: (chave) => AsyncStorage.getItem(chave),
  set: (chave, valor) => AsyncStorage.setItem(chave, valor),
  remove: (chave) => AsyncStorage.removeItem(chave),
};

export const api = new AooobaApi(API_URL);
export const armazenamento = new ArmazenamentoLocal(store, () => randomUUID());
