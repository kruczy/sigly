import type { Dependency, TrackResult } from "./types.js";
import type {
  ComputedNodeContext,
  NodeId,
  RuntimeNode,
  TrackedNodeIds,
  ValueNodeContext,
} from "./runtime.js";

const nodes = new Map<NodeId, RuntimeNode>();
const trackingStack: (Set<NodeId> | undefined)[] = [];
const pendingNotifications = new Set<NodeId>();

let nextId = 0;
let flushScheduled = false;
let flushing = false;

export const valueNodeContext: ValueNodeContext = {
  markObserversDirty,
  queueNotification,
  recordDependency,
  scheduleFlush,
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

export function registerNode(node: RuntimeNode): void {
  nodes.set(node.id, node);
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

  for (const dependencyId of node.dependencies) {
    if (!next.has(dependencyId)) {
      const dependency = requireNode(dependencyId);
      dependency.observers.delete(node.id);
      dependency.syncSubscription();
    }
  }

  for (const dependencyId of next) {
    if (!node.dependencies.has(dependencyId)) {
      const dependency = requireNode(dependencyId);
      dependency.observers.add(node.id);
      dependency.syncSubscription();
    }
  }

  node.dependencies = next;
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

  for (const observerId of requireNode(id).observers) {
    const observer = requireNode(observerId);

    if (observer.kind === "computed") {
      observer.dirty = true;
      markObserversDirty(observer.id, visited);
    }
  }
}

function queueNotification(node: RuntimeNode): void {
  if (node.hasSubscribers()) {
    pendingNotifications.add(node.id);
  }
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

      for (const node of nodes.values()) {
        if (node.kind === "computed" && node.dirty && node.hasSubscribers()) {
          node.ensureFresh();
          recomputed = true;
        }
      }
    }

    const queuedNotifications = Array.from(pendingNotifications);
    pendingNotifications.clear();

    for (const id of queuedNotifications) {
      requireNode(id).notifySubscribers();
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
  const node = nodes.get(id);

  if (node === undefined) {
    throw new RangeError(`Unknown sigly node id: ${id}.`);
  }

  return node;
}
