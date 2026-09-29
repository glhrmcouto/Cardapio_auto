import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { instalarWebSocketFalso, limparChamadas, server } from './msw';

// Antes de qualquer import de lib/supabase (o cliente lê estas variáveis ao ser criado).
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key');

// API do Supabase mockada com MSW: qualquer requisição sem handler falha o teste.
beforeAll(() => {
  instalarWebSocketFalso();
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => server.close());

afterEach(() => {
  cleanup();
  server.resetHandlers();
  limparChamadas();
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

// jsdom não implementa IntersectionObserver (usado no fade-in do cardápio).
class IntersectionObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverFalso);

// jsdom também não implementa scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

// jsdom não tem canvas (QR codes); as bibliotecas de desenho são cobertas por mock nos testes de relatório.
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
