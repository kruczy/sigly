import { computedNodeContext, createNodeId, registerNode } from "./registry.js";
import type { ComputedObservable, Subscriber } from "./types.js";
import type { ComputedNodeContext, CreatedNode, NodeId, RuntimeNode } from "./runtime.js";

type ComputedState<T> =
  | {
      readonly initialized: false;
    }
  | {
      readonly initialized: true;
      readonly value: T;
    };

export function computed$<T>(compute: () => T): ComputedObservable<T> {
  const { observable, node } = createComputedNode(createNodeId(), compute, computedNodeContext);

  registerNode(node);
  return observable;
}

function createComputedNode<T>(
  id: NodeId,
  compute: () => T,
  context: ComputedNodeContext,
): CreatedNode<ComputedObservable<T>> {
  const subscribers = new Map<Subscriber<T>, T>();
  let state: ComputedState<T> = { initialized: false };
  let computing = false;
  let node: RuntimeNode;

  const readState = (): T => {
    if (!state.initialized) {
      throw new Error(`Computed node ${id} did not produce a value.`);
    }

    return state.value;
  };

  const ensureFresh = (): void => {
    if (state.initialized && !node.dirty) {
      return;
    }

    if (computing) {
      throw new Error(`Cycle detected while computing node ${id}.`);
    }

    const previousState = state;
    computing = true;

    try {
      const { value, dependencies } = context.trackNodeIds(compute);
      context.replaceDependencies(node, dependencies);
      state = {
        initialized: true,
        value,
      };
      node.dirty = false;

      if (previousState.initialized && !Object.is(previousState.value, value)) {
        context.queueNotification(node);
        context.markObserversDirty(id);

        if (!context.isFlushing()) {
          context.scheduleFlush();
        }
      }
    } finally {
      computing = false;
    }
  };

  const getFreshValue = (): T => {
    ensureFresh();
    return readState();
  };

  const computeUntracked = (): T => {
    if (computing) {
      throw new Error(`Cycle detected while computing node ${id}.`);
    }

    computing = true;

    try {
      return context.untrack(compute);
    } finally {
      computing = false;
    }
  };

  const peek = (): T => {
    if (context.isTracking()) {
      if (state.initialized && !node.dirty) {
        return state.value;
      }

      return computeUntracked();
    }

    return getFreshValue();
  };

  const observable: ComputedObservable<T> = {
    id,
    get: () => {
      const isTracked = context.recordDependency(id);

      if (!isTracked && subscribers.size === 0 && node.observers.size === 0) {
        return computeUntracked();
      }

      return getFreshValue();
    },
    peek,
    subscribe: (subscriber) => {
      const value = getFreshValue();
      subscribers.set(subscriber, value);

      return () => {
        subscribers.delete(subscriber);
      };
    },
  };

  node = {
    id,
    kind: "computed",
    observable,
    dependencies: new Map(),
    observers: new Set(),
    dirty: true,
    hasSubscribers: () => subscribers.size > 0,
    ensureFresh,
    notifySubscribers: () => {
      if (!state.initialized) {
        return;
      }

      for (const [subscriber, previousValue] of Array.from(subscribers.entries())) {
        if (!subscribers.has(subscriber) || Object.is(previousValue, state.value)) {
          continue;
        }

        subscribers.set(subscriber, state.value);
        subscriber(state.value, previousValue);
      }
    },
    syncSubscription: () => {},
  };

  return {
    observable,
    node,
  };
}
