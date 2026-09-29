import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RequireAuth } from '../RequireAuth';
import { criarSupabaseFalso, type SupabaseFalso } from '../../test/supabaseMock';

const SESSION = { user: { id: 'u1' } };

function montar(falso: SupabaseFalso, papeis: ('admin' | 'balcao' | 'garcom')[] | null) {
  return render(
    <RequireAuth cliente={falso as unknown as SupabaseClient} titulo="Administrador" papeis={papeis}>
      {({ papel }) => <div>CONTEÚDO {papel ?? 'sem-papel'}</div>}
    </RequireAuth>,
  );
}

describe('RequireAuth', () => {
  it('sem sessão mostra a tela de login e esconde o conteúdo', async () => {
    montar(criarSupabaseFalso(), ['admin']);
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.queryByText(/CONTEÚDO/)).not.toBeInTheDocument();
  });

  it('sessão + papel aceito libera o conteúdo com o papel', async () => {
    const falso = criarSupabaseFalso({ tabelas: { perfis: { data: { papel: 'admin' } } } });
    falso.auth.getSession.mockResolvedValue({ data: { session: SESSION as never } });
    montar(falso, ['admin']);
    expect(await screen.findByText('CONTEÚDO admin')).toBeInTheDocument();
  });

  it('papel não aceito: barra, mostra mensagem e desloga', async () => {
    const falso = criarSupabaseFalso({ tabelas: { perfis: { data: { papel: 'balcao' } } } });
    falso.auth.getSession.mockResolvedValue({ data: { session: SESSION as never } });
    montar(falso, ['admin']);
    expect(await screen.findByRole('alert')).toHaveTextContent('não tem permissão');
    expect(falso.auth.signOut).toHaveBeenCalled();
    expect(screen.queryByText(/CONTEÚDO/)).not.toBeInTheDocument();
  });

  it('usuário sem perfil também é barrado', async () => {
    const falso = criarSupabaseFalso({ tabelas: { perfis: { data: null } } });
    falso.auth.getSession.mockResolvedValue({ data: { session: SESSION as never } });
    montar(falso, ['admin']);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(falso.auth.signOut).toHaveBeenCalled();
  });

  it('papeis=null (balcão): basta a sessão, sem consultar perfis', async () => {
    const falso = criarSupabaseFalso();
    falso.auth.getSession.mockResolvedValue({ data: { session: SESSION as never } });
    montar(falso, null);
    expect(await screen.findByText('CONTEÚDO sem-papel')).toBeInTheDocument();
    expect(falso.from).not.toHaveBeenCalled();
  });

  it('senha errada mostra "E-mail ou senha inválidos."', async () => {
    const falso = criarSupabaseFalso();
    falso.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'x' } } as never);
    montar(falso, ['admin']);
    await userEvent.type(await screen.findByLabelText('E-mail'), 'dono@bar.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
    expect(falso.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'dono@bar.com', password: 'errada' });
  });

  it('login correto com papel certo entra no conteúdo', async () => {
    const falso = criarSupabaseFalso({ tabelas: { perfis: { data: { papel: 'admin' } } } });
    falso.auth.signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null } as never);
    montar(falso, ['admin']);
    await userEvent.type(await screen.findByLabelText('E-mail'), 'dono@bar.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'certa');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(screen.getByText('CONTEÚDO admin')).toBeInTheDocument());
  });
});
