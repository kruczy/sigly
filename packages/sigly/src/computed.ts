import { computedNodeContext, createNodeId, registerNode } from "./registry.js";
import type { ComputedObservable } from "./types.js";
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

      if (!isTracked && !context.hasSubscribers(node) && node.observers.size === 0) {
        return computeUntracked();
      }

      return getFreshValue();
    },
    peek,
    subscribe: (subscriber) => {
      ensureFresh();
      return context.subscribe(node, subscriber, readState);
    },
  };

  node = {
    id,
    kind: "computed",
    observable,
    dependencies: new Map(),
    observers: new Set(),
    dirty: true,
    ensureFresh,
  };

  return {
    observable,
    node,
  };
}
