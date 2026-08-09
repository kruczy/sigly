import type { NodeKind, Observable, Subscriber, Unsubscribe } from "./types.js";

export type NodeId = number;

export type RuntimeNode = {
  readonly id: NodeId;
  readonly kind: NodeKind;
  readonly observable: Observable<unknown>;
  dependencies: Map<NodeId, RuntimeNode>;
  observers: Set<NodeId>;
  dirty: boolean;
  ensureFresh(): void;
};

export type RuntimeSource = {
  reset(): void;
  subscribe(): Unsubscribe;
};

export type TrackedNodeIds<T> = {
  readonly value: T;
  readonly dependencies: readonly NodeId[];
};

export type ValueNodeContext = {
  activateSource(node: RuntimeNode): void;
  hasSubscribers(node: RuntimeNode): boolean;
  isSourceActive(node: RuntimeNode): boolean;
  recordDependency(id: NodeId): boolean;
  queueNotification(node: RuntimeNode): void;
  markObserversDirty(id: NodeId): void;
  scheduleFlush(): void;
  subscribe<T>(node: RuntimeNode, subscriber: Subscriber<T>, read: () => T): Unsubscribe;
};

export type ComputedNodeContext = ValueNodeContext & {
  trackNodeIds<T>(callback: () => T): TrackedNodeIds<T>;
  replaceDependencies(node: RuntimeNode, nextDependencies: readonly NodeId[]): void;
  isFlushing(): boolean;
  isTracking(): boolean;
  untrack<T>(callback: () => T): T;
};

export type CreatedNode<TObservable> = {
  readonly observable: TObservable;
  readonly node: RuntimeNode;
};
