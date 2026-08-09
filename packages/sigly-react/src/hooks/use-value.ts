import { useCallback, useSyncExternalStore } from "react";
import type { Observable, Unsubscribe } from "sigly";

export function useValue<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (notify: () => void): Unsubscribe => observable.subscribe(() => notify()),
    [observable],
  );
  const getSnapshot = useCallback((): T => observable.get(), [observable]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
