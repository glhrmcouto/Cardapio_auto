/**
 * Base dos ViewModels (MVVM). Um ViewModel guarda o estado da tela e as ações do usuário, fala com o
 * Model (api/armazenamento/regras) e NÃO conhece React Native: a View só lê `getState()` e chama métodos.
 * Por isso dá para testar tudo com Jest puro, sem renderizar nada.
 */
export abstract class ViewModel<S extends object> {
  private estado: S;
  private ouvintes = new Set<() => void>();

  constructor(inicial: S) {
    this.estado = inicial;
  }

  /** Referência estável entre mudanças (exigência do useSyncExternalStore). */
  getState = (): S => this.estado;

  subscribe = (ouvinte: () => void): (() => void) => {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  };

  protected setState(parcial: Partial<S>) {
    this.estado = { ...this.estado, ...parcial };
    this.ouvintes.forEach((o) => o());
  }

  /** Para timers/polling. A View chama ao desmontar; quem assina já sai pelo `subscribe`. */
  dispose() {}
}
