export type NodeKind = "value" | "computed" | "observable";

export type Subscriber<T> = (value: T, previousValue: T) => void;

export type Unsubscribe = () => void;

export interface Observable<T> {
  readonly id: number;
  get(): T;
  peek(): T;
  subscribe(subscriber: Subscriber<T>): Unsubscribe;
}

export interface ValueObservable<T> extends Observable<T> {
  set(value: T): void;
}

export interface ComputedObservable<T> extends Observable<T> {}

export interface ObservableOptions<T> {
  get(): T;
  subscribe(emit: (value: T) => void): Unsubscribe;
}

export interface Dependency<T = unknown> {
  readonly id: number;
  readonly kind: NodeKind;
  readonly observable: Observable<T>;
}

export interface TrackResult<T> {
  readonly value: T;
  readonly dependencies: readonly Dependency[];
}
