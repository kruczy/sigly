import { createNodeId, registerNode, valueNodeContext } from "./registry.js";
import type { ValueObservable } from "./types.js";
import type { CreatedNode, NodeId, RuntimeNode, ValueNodeContext } from "./runtime.js";

export function value$<T>(initialValue: T): ValueObservable<T> {
  const { observable, node } = createValueNode(createNodeId(), initialValue, valueNodeContext);

  registerNode(node);
  return observable;
}

function createValueNode<T>(
  id: NodeId,
  initialValue: T,
  context: ValueNodeContext,
): CreatedNode<ValueObservable<T>> {
  let value = initialValue;
  let node: RuntimeNode;

  const observable: ValueObservable<T> = {
    id,
    get: () => {
      context.recordDependency(id);
      return value;
    },
    peek: () => value,
    set: (nextValue) => {
      if (Object.is(value, nextValue)) {
        return;
      }

      value = nextValue;
      context.queueNotification(node);
      context.markObserversDirty(id);
      context.scheduleFlush();
    },
    subscribe: (subscriber) => context.subscribe(node, subscriber, () => value),
  };

  node = {
    id,
    kind: "value",
    observable,
    dependencies: new Map(),
    observers: new Set(),
    dirty: false,
    ensureFresh: () => {},
  };

  return {
    observable,
    node,
  };
}
