import { createNodeId, registerNode, valueNodeContext } from "./registry.js";
import type { Subscriber, ValueObservable } from "./types.js";
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
  const subscribers = new Map<Subscriber<T>, T>();
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
    subscribe: (subscriber) => {
      subscribers.set(subscriber, value);

      return () => {
        subscribers.delete(subscriber);
      };
    },
  };

  node = {
    id,
    kind: "value",
    observable,
    dependencies: new Map(),
    observers: new Set(),
    dirty: false,
    hasSubscribers: () => subscribers.size > 0,
    ensureFresh: () => {},
    notifySubscribers: () => {
      for (const [subscriber, previousValue] of Array.from(subscribers.entries())) {
        if (!subscribers.has(subscriber) || Object.is(previousValue, value)) {
          continue;
        }

        subscribers.set(subscriber, value);
        subscriber(value, previousValue);
      }
    },
    syncSubscription: () => {},
  };

  return {
    observable,
    node,
  };
}
