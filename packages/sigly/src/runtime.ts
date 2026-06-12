import type { NodeKind, Observable } from "./types.js";

export type NodeId = number;

export type RuntimeNode = {
  readonly id: NodeId;
  readonly kind: NodeKind;
  readonly observable: Observable<unknown>;
  dependencies: Set<NodeId>;
  observers: Set<NodeId>;
  dirty: boolean;
  hasSubscribers(): boolean;
  ensureFresh(): void;
  notifySubscribers(): void;
  syncSubscription(): void;
};

export type TrackedNodeIds<T> = {
  readonly value: T;
  readonly dependencies: readonly NodeId[];
};

export type ValueNodeContext = {
  recordDependency(id: NodeId): boolean;
  queueNotification(node: RuntimeNode): void;
  markObserversDirty(id: NodeId): void;
  scheduleFlush(): void;
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
