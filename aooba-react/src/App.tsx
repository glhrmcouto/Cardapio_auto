import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

const Cardapio = lazy(() => import('./pages/Cardapio'));
const Balcao = lazy(() => import('./pages/Balcao'));
const Garcom = lazy(() => import('./pages/Garcom'));
const Admin = lazy(() => import('./pages/Admin'));
const Mesas = lazy(() => import('./pages/Mesas'));
const Relatorios = lazy(() => import('./pages/Relatorios'));
const GerarQrCodes = lazy(() => import('./pages/GerarQrCodes'));
const NaoEncontrado = lazy(() => import('./pages/NaoEncontrado'));

export function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Cardapio />} />
        {/* Compatibilidade com QR codes já impressos (/index.html?mesa=..&t=..) e links antigos */}
        <Route path="/index.html" element={<Cardapio />} />
        <Route path="/balcao" element={<Balcao />} />
        <Route path="/balcao.html" element={<Balcao />} />
        <Route path="/garcom" element={<Garcom />} />
        <Route path="/garcom.html" element={<Garcom />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin.html" element={<Admin />} />
        <Route path="/mesas" element={<Mesas />} />
        <Route path="/mesas.html" element={<Mesas />} />
        <Route path="/relatorios" element={<Relatorios />} />
        <Route path="/relatorios.html" element={<Relatorios />} />
        <Route path="/gerar-qrcodes" element={<GerarQrCodes />} />
        <Route path="/gerar-qrcodes.html" element={<GerarQrCodes />} />
        <Route path="*" element={<NaoEncontrado />} />
      </Routes>
    </Suspense>
  );
}
