import { useEffect, type DependencyList } from "react";
import type { Observable, Subscriber } from "sigly";

export function useObserve<T>(
  observable: Observable<T>,
  callback: Subscriber<T>,
  deps: DependencyList,
): void {
  useEffect(() => observable.subscribe(callback), [observable, ...deps]);
}
