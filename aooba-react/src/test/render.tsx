import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ToastProvider } from '../components/Toast';

/** Renderiza uma página com Router em memória e Toast, como no app real. */
export function renderPagina(ui: ReactElement, url = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );
}
