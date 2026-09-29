import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Evita criar clientes Supabase reais nos testes.
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key');

afterEach(() => {
  cleanup();
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
