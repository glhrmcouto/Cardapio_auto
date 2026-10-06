import { useRouter } from 'expo-router';
import { ScannerScreen } from '../view/ScannerScreen';

export default function Inicio() {
  const router = useRouter();
  return <ScannerScreen aoLerMesa={({ mesa, token }) => router.push({ pathname: '/cardapio', params: { mesa: String(mesa), t: token } })} />;
}
