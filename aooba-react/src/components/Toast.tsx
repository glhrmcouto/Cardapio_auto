import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<(mensagem: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [mensagem, setMensagem] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const mostrar = useCallback((msg: string) => {
    setMensagem(msg);
    setShow(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(false), 3500);
  }, []);

  return (
    <ToastContext.Provider value={mostrar}>
      {children}
      <div className={`toast${show ? ' show' : ''}`}>{mensagem}</div>
    </ToastContext.Provider>
  );
}
