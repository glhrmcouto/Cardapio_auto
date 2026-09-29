import type { SupabaseClient } from '@supabase/supabase-js';
import { CONTA_VAZIA, obterContaAtivaDaMesa, tentarEncerrarSessao } from '../contas';

type Resp = { data?: unknown; error?: { message: string; details?: string } | null };
function clienteFake(respostas: Resp[]) {
  const rpc = vi.fn().mockImplementation(async () => respostas.shift() ?? { data: null, error: null });
  return { cliente: { rpc } as unknown as SupabaseClient, rpc };
}
const ui = () => ({ confirm: vi.fn(), alert: vi.fn() });

describe('obterContaAtivaDaMesa', () => {
  it('devolve os dados da RPC', async () => {
    const conta = { ...CONTA_VAZIA, total_geral: 50 };
    const { cliente, rpc } = clienteFake([{ data: conta }]);
    expect(await obterContaAtivaDaMesa(cliente, '3')).toEqual(conta);
    expect(rpc).toHaveBeenCalledWith('conta_da_mesa_balcao', { p_mesa: 3 });
  });

  it('em erro devolve conta vazia (não quebra a tela)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cliente } = clienteFake([{ error: { message: 'falhou' } }]);
    expect(await obterContaAtivaDaMesa(cliente, 3)).toEqual(CONTA_VAZIA);
  });
});

describe('tentarEncerrarSessao', () => {
  it('sucesso direto não pergunta nada', async () => {
    const { cliente, rpc } = clienteFake([{ error: null }]);
    const u = ui();
    expect(await tentarEncerrarSessao(cliente, 4, u)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('encerrar_sessao', { p_mesa: 4, p_forcar: false });
    expect(u.confirm).not.toHaveBeenCalled();
  });

  it('CONTA_JA_ENCERRADA avisa e segue como sucesso', async () => {
    const { cliente } = clienteFake([{ error: { message: 'já encerrada', details: 'CONTA_JA_ENCERRADA' } }]);
    const u = ui();
    expect(await tentarEncerrarSessao(cliente, 4, u)).toBe(true);
    expect(u.alert).toHaveBeenCalledWith('já encerrada');
  });

  it('saldo pendente: se o usuário confirma, chama de novo com p_forcar=true', async () => {
    const { cliente, rpc } = clienteFake([{ error: { message: 'Ainda falta receber R$ 10,00' } }, { error: null }]);
    const u = ui();
    u.confirm.mockReturnValue(true);
    expect(await tentarEncerrarSessao(cliente, 4, u)).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('encerrar_sessao', { p_mesa: 4, p_forcar: true });
  });

  it('saldo pendente: se o usuário recusa, não força e devolve false', async () => {
    const { cliente, rpc } = clienteFake([{ error: { message: 'Ainda falta receber R$ 10,00' } }]);
    const u = ui();
    u.confirm.mockReturnValue(false);
    expect(await tentarEncerrarSessao(cliente, 4, u)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('falha ao forçar avisa e devolve false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cliente } = clienteFake([{ error: { message: 'Ainda falta receber R$ 1' } }, { error: { message: 'boom' } }]);
    const u = ui();
    u.confirm.mockReturnValue(true);
    expect(await tentarEncerrarSessao(cliente, 4, u)).toBe(false);
    expect(u.alert).toHaveBeenCalled();
  });

  it('outro erro só avisa com a mensagem do servidor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cliente } = clienteFake([{ error: { message: 'Sessão inexistente' } }]);
    const u = ui();
    expect(await tentarEncerrarSessao(cliente, 4, u)).toBe(false);
    expect(u.alert).toHaveBeenCalledWith('Sessão inexistente');
    expect(u.confirm).not.toHaveBeenCalled();
  });
});
