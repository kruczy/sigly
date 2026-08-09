import type { Dependency, Subscriber, TrackResult, Unsubscribe } from "./types.js";
import type {
  ComputedNodeContext,
  NodeId,
  RuntimeNode,
  RuntimeSource,
  TrackedNodeIds,
  ValueNodeContext,
} from "./runtime.js";

type SourceState = {
  readonly source: RuntimeSource;
  active: boolean;
  unsubscribe: Unsubscribe | undefined;
};

type NodeState = {
  readonly subscribers: Map<object, () => void>;
  readonly source: SourceState | undefined;
};

const nodes = new Map<NodeId, WeakRef<RuntimeNode>>();
const nodeStates = new WeakMap<RuntimeNode, NodeState>();
const trackingStack: (Set<NodeId> | undefined)[] = [];
const pendingNotifications = new Set<NodeId>();

let nextId = 0;
let flushScheduled = false;
let flushing = false;

export const valueNodeContext: ValueNodeContext = {
  activateSource,
  hasSubscribers,
  isSourceActive,
  markObserversDirty,
  queueNotification,
  recordDependency,
  scheduleFlush,
  subscribe,
};

export const computedNodeContext: ComputedNodeContext = {
  ...valueNodeContext,
  isFlushing: () => flushing,
  isTracking,
  replaceDependencies,
  trackNodeIds,
  untrack,
};

export function createNodeId(): NodeId {
  const id = nextId;
  nextId += 1;
  return id;
}

export function registerNode(node: RuntimeNode, source?: RuntimeSource): void {
  nodes.set(node.id, new WeakRef(node));
  nodeStates.set(node, {
    subscribers: new Map(),
    source:
      source === undefined
        ? undefined
        : {
            source,
            active: false,
            unsubscribe: undefined,
          },
  });
}

export function track<T>(callback: () => T): TrackResult<T> {
  const { value, dependencies } = trackNodeIds(callback);

  return {
    value,
    dependencies: dependencies.map((id) => dependencyFor(id)),
  };
}

function trackNodeIds<T>(callback: () => T): TrackedNodeIds<T> {
  const dependencies = new Set<NodeId>();
  trackingStack.push(dependencies);

  try {
    return {
      value: callback(),
      dependencies: Array.from(dependencies),
    };
  } finally {
    trackingStack.pop();
  }
}

function untrack<T>(callback: () => T): T {
  trackingStack.push(undefined);

  try {
    return callback();
  } finally {
    trackingStack.pop();
  }
}

function isTracking(): boolean {
  return trackingStack.at(-1) !== undefined;
}

function replaceDependencies(node: RuntimeNode, nextDependencies: readonly NodeId[]): void {
  const next = new Set(nextDependencies);
  const nextDependencyNodes = new Map<NodeId, RuntimeNode>();

  for (const dependencyId of next) {
    nextDependencyNodes.set(dependencyId, requireNode(dependencyId));
  }

  for (const [dependencyId, dependency] of node.dependencies) {
    if (!next.has(dependencyId)) {
      dependency.observers.delete(node.id);
      syncSourceSubscription(dependency);
    }
  }

  for (const [dependencyId, dependency] of nextDependencyNodes) {
    if (!node.dependencies.has(dependencyId)) {
      dependency.observers.add(node.id);
      syncSourceSubscription(dependency);
    }
  }

  node.dependencies = nextDependencyNodes;
}

function recordDependency(id: NodeId): boolean {
  const currentTracker = trackingStack.at(-1);

  if (currentTracker !== undefined) {
    currentTracker.add(id);
    return true;
  }

  return false;
}

function markObserversDirty(id: NodeId, visited = new Set<NodeId>()): void {
  if (visited.has(id)) {
    return;
  }

  visited.add(id);

  const node = requireNode(id);

  for (const observerId of Array.from(node.observers)) {
    const observer = lookupNode(observerId);

    if (observer === undefined) {
      node.observers.delete(observerId);
      syncSourceSubscription(node);
      continue;
    }

    if (observer.kind === "computed") {
      observer.dirty = true;
      markObserversDirty(observer.id, visited);
    }
  }
}

function queueNotification(node: RuntimeNode): void {
  if (hasSubscribers(node)) {
    pendingNotifications.add(node.id);
  }
}

function subscribe<T>(node: RuntimeNode, subscriber: Subscriber<T>, read: () => T): Unsubscribe {
  syncSourceSubscription(node, true);

  const id = node.id;
  const subscribers = requireNodeState(node).subscribers;
  let previousValue = read();

  subscribers.set(subscriber, () => {
    const value = read();

    if (Object.is(previousValue, value)) {
      return;
    }

    const lastValue = previousValue;
    previousValue = value;
    subscriber(value, lastValue);
  });

  return () => {
    subscribers.delete(subscriber);

    const liveNode = lookupNode(id);

    if (liveNode !== undefined) {
      syncSourceSubscription(liveNode);
    }
  };
}

function hasSubscribers(node: RuntimeNode): boolean {
  return requireNodeState(node).subscribers.size > 0;
}

function notifySubscribers(node: RuntimeNode): void {
  const subscribers = requireNodeState(node).subscribers;

  for (const [subscriber, notify] of Array.from(subscribers.entries())) {
    if (!subscribers.has(subscriber)) {
      continue;
    }

    notify();
  }
}

function activateSource(node: RuntimeNode): void {
  syncSourceSubscription(node, true);
}

function isSourceActive(node: RuntimeNode): boolean {
  return requireSourceState(node).active;
}

function syncSourceSubscription(node: RuntimeNode, force = false): void {
  const state = requireNodeState(node);
  const source = state.source;

  if (source === undefined) {
    return;
  }

  const shouldSubscribe = force || state.subscribers.size > 0 || node.observers.size > 0;

  if (shouldSubscribe) {
    startSourceSubscription(source);
    return;
  }

  stopSourceSubscription(source);
}

function startSourceSubscription(source: SourceState): void {
  if (source.active) {
    return;
  }

  source.active = true;

  try {
    source.unsubscribe = source.source.subscribe();
  } catch (error) {
    source.active = false;
    source.unsubscribe = undefined;
    source.source.reset();
    throw error;
  }
}

function stopSourceSubscription(source: SourceState): void {
  if (!source.active) {
    return;
  }

  const unsubscribe = source.unsubscribe;

  source.active = false;
  source.unsubscribe = undefined;
  source.source.reset();
  unsubscribe?.();
}

function scheduleFlush(): void {
  if (flushScheduled) {
    return;
  }

  flushScheduled = true;
  queueMicrotask(() => {
    flush();
  });
}

function flush(): void {
  flushScheduled = false;
  flushing = true;

  try {
    let recomputed = true;

    while (recomputed) {
      recomputed = false;

      for (const node of liveNodes()) {
        if (node.kind === "computed" && node.dirty && hasSubscribers(node)) {
          node.ensureFresh();
          recomputed = true;
        }
      }
    }

    const queuedNotifications = Array.from(pendingNotifications);
    pendingNotifications.clear();

    for (const id of queuedNotifications) {
      const node = lookupNode(id);

      if (node !== undefined) {
        notifySubscribers(node);
      }
    }
  } finally {
    flushing = false;
  }
}

function dependencyFor(id: NodeId): Dependency {
  const node = requireNode(id);

  return {
    id: node.id,
    kind: node.kind,
    observable: node.observable,
  };
}

function requireNode(id: NodeId): RuntimeNode {
  const node = lookupNode(id);

  if (node === undefined) {
    throw new RangeError(`Unknown sigly node id: ${id}.`);
  }

  return node;
}

function requireNodeState(node: RuntimeNode): NodeState {
  const state = nodeStates.get(node);

  if (state === undefined) {
    throw new RangeError(`Unknown sigly node id: ${node.id}.`);
  }

  return state;
}

function requireSourceState(node: RuntimeNode): SourceState {
  const source = requireNodeState(node).source;

  if (source === undefined) {
    throw new TypeError(`Sigly node ${node.id} is not a source observable.`);
  }

  return source;
}

function lookupNode(id: NodeId): RuntimeNode | undefined {
  const nodeRef = nodes.get(id);
  const node = nodeRef?.deref();

  if (nodeRef !== undefined && node === undefined) {
    cleanupCollectedNode(id);
  }

  return node;
}

function liveNodes(): RuntimeNode[] {
  const live: RuntimeNode[] = [];
  const collectedIds: NodeId[] = [];

  for (const [id, nodeRef] of nodes) {
    const node = nodeRef.deref();

    if (node === undefined) {
      nodes.delete(id);
      pendingNotifications.delete(id);
      collectedIds.push(id);
      continue;
    }

    live.push(node);
  }

  if (collectedIds.length > 0) {
    removeObserverLinks(collectedIds, live);
  }

  return live;
}

function cleanupCollectedNode(id: NodeId): void {
  const nodeRef = nodes.get(id);

  if (nodeRef?.deref() !== undefined) {
    return;
  }

  nodes.delete(id);
  pendingNotifications.delete(id);
  removeObserverLinks([id], liveNodes());
}

function removeObserverLinks(ids: readonly NodeId[], live: readonly RuntimeNode[]): void {
  for (const node of live) {
    let observersChanged = false;

    for (const id of ids) {
      observersChanged = node.observers.delete(id) || observersChanged;
    }

    if (observersChanged) {
      syncSourceSubscription(node);
    }
  }
}
