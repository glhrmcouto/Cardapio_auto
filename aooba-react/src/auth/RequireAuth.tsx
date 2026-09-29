import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import type { Papel } from '../lib/types';

interface Props {
  cliente: SupabaseClient;
  titulo: string;
  /** Papéis aceitos; null = basta estar logado (balcão). */
  papeis: Papel[] | null;
  mensagemSemPermissao?: string;
  children: (ctx: { papel: Papel | null; sair: () => void }) => ReactNode;
}

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'login'; erro?: string }
  | { tipo: 'ok'; papel: Papel | null };

/**
 * Substitui o configurarLogin do JS antigo: tela de login + checagem de papel
 * na tabela "perfis". As RPCs/RLS conferem o papel de novo no banco.
 */
export function RequireAuth({
  cliente,
  titulo,
  papeis,
  mensagemSemPermissao = 'Este usuário não tem permissão de administrador.',
  children,
}: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function verificar(session: Session | null) {
    if (!session) {
      setEstado({ tipo: 'login' });
      return;
    }
    if (!papeis) {
      setEstado({ tipo: 'ok', papel: null });
      return;
    }
    const { data: perfil, error } = await cliente
      .from('perfis')
      .select('papel')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) {
      console.error('Erro ao verificar permissão de acesso:', error);
      setEstado({ tipo: 'login', erro: 'Não foi possível verificar sua permissão agora. Tente de novo.' });
      await cliente.auth.signOut();
      return;
    }
    if (!perfil || !papeis.includes(perfil.papel as Papel)) {
      setEstado({ tipo: 'login', erro: mensagemSemPermissao });
      await cliente.auth.signOut();
      return;
    }
    setEstado({ tipo: 'ok', papel: perfil.papel as Papel });
  }

  useEffect(() => {
    let vivo = true;
    void cliente.auth.getSession().then(({ data }) => {
      if (vivo) void verificar(data.session);
    });
    const { data: sub } = cliente.auth.onAuthStateChange((_evento, session) => {
      if (!session) setEstado({ tipo: 'login' });
      else if (!papeis) setEstado({ tipo: 'ok', papel: null });
      // Com papéis, só reage a logout (evita reconsultar o papel a cada refresh de token).
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente]);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setEntrando(true);
    const { data, error } = await cliente.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEntrando(false);
    if (error) {
      setEstado({ tipo: 'login', erro: 'E-mail ou senha inválidos.' });
      return;
    }
    setSenha('');
    await verificar(data.session);
  }

  if (estado.tipo === 'carregando') return null;

  if (estado.tipo === 'login') {
    return (
      <div className="login-tela" style={{ display: 'flex' }}>
        <form className="login-card" onSubmit={entrar} noValidate>
          <h1 className="login-card__titulo">
            AOOBA! <span>— {titulo}</span>
          </h1>
          <label htmlFor="loginEmail">E-mail</label>
          <input id="loginEmail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="loginSenha">Senha</label>
          <input id="loginSenha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          {estado.erro && (
            <p className="login-card__erro" role="alert" style={{ display: 'block' }}>
              {estado.erro}
            </p>
          )}
          <button type="submit" className="btn btn--primary login-card__entrar" disabled={entrando}>
            {entrando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    );
  }

  return <>{children({ papel: estado.papel, sair: () => void cliente.auth.signOut() })}</>;
}
