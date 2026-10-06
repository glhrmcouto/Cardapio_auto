import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ViewModel } from './ViewModel';

/** Liga um ViewModel à View: re-renderiza quando o estado muda. */
export function useViewModelState<S extends object>(vm: ViewModel<S>): S {
  return useSyncExternalStore(vm.subscribe, vm.getState, vm.getState);
}

/** Cria o ViewModel uma única vez por montagem e o descarta ao desmontar. */
export function useViewModel<V extends ViewModel<object>>(criar: () => V): V {
  const ref = useRef<V | null>(null);
  if (ref.current === null) ref.current = criar();
  const vm = ref.current;
  useEffect(() => () => vm.dispose(), [vm]);
  return vm;
}
