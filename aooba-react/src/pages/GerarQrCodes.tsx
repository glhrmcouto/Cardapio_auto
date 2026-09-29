import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AdminLayout } from '../components/AdminLayout';
import { supabase } from '../lib/supabase';
import { montarUrlMesa } from '../lib/shared';
import '../styles/gerar-qrcodes.css';

type MesaQr = { numero: number; token: string };

function QrCard({ mesa }: { mesa: MesaQr }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [falha, setFalha] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, montarUrlMesa(mesa), {
      width: 200,
      margin: 1,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    }).catch((erro: unknown) => {
      console.error(`Erro ao gerar QR code da mesa ${mesa.numero}:`, erro);
      setFalha(true);
    });
  }, [mesa]);

  return (
    <div className="qr-card">
      <span className="qr-card__marca">AOOBA! BAR</span>
      <span className="qr-card__mesa-label">Mesa</span>
      <span className="qr-card__mesa-numero">{mesa.numero}</span>
      {falha ? <span className="qr-card__falha">Não foi possível gerar este QR code.</span> : <canvas ref={canvasRef} className="qr-card__canvas" />}
      <p className="qr-card__instrucao">
        Aponte a câmera do celular
        <br />e peça direto pela mesa.
      </p>
    </div>
  );
}

export default function GerarQrCodes() {
  const [mesas, setMesas] = useState<MesaQr[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(false);
    const { data, error } = await supabase.from('mesas').select('numero, token').eq('ativa', true).order('numero');
    if (error) {
      console.error('Erro ao carregar mesas:', error);
      setErro(true);
    } else {
      setMesas(data as MesaQr[]);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <AdminLayout atual="gerar-qrcodes" titulo="QR codes" docTitle="AOOBA! — Gerar QR codes">
      <div className="admin-toolbar">
        <h1 className="admin-titulo">Gerar QR codes das mesas</h1>
        <div className="qr-acoes">
          <button type="button" className="btn btn--secondary" onClick={() => void carregar()}>
            Recarregar
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </div>

      <p className="qr-instrucoes">
        Um QR code por mesa <strong>ativa</strong> cadastrada em Mesas, já apontando pro link certo dessa mesa. Se você acabou de adicionar ou
        reativar uma mesa, clique em "Recarregar".
      </p>

      {carregando && <p className="cardapio-status">Carregando mesas...</p>}
      {erro && (
        <div className="cardapio-status cardapio-status--erro">
          <p>Não foi possível carregar as mesas agora. Verifique sua conexão e tente de novo.</p>
          <button type="button" className="btn btn--secondary" onClick={() => void carregar()}>
            Tentar novamente
          </button>
        </div>
      )}
      {!carregando && !erro && mesas.length === 0 && (
        <p className="cardapio-status">Nenhuma mesa ativa cadastrada ainda — adicione mesas em Mesas primeiro.</p>
      )}

      <div className="qr-grid">
        {mesas.map((m) => (
          <QrCard key={`${m.numero}-${m.token}`} mesa={m} />
        ))}
      </div>
    </AdminLayout>
  );
}
