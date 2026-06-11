import { createNodeId, registerNode, valueNodeContext } from "./registry.js";
import type { Observable, ObservableOptions, Subscriber, Unsubscribe } from "./types.js";
import type { CreatedNode, NodeId, RuntimeNode, ValueNodeContext } from "./runtime.js";

type EmittedState<T> =
  | {
      readonly kind: "empty";
    }
  | {
      readonly kind: "ready";
      readonly value: T;
    };

export function observable$<T>(options: ObservableOptions<T>): Observable<T> {
  const { observable, node } = createObservableNode(createNodeId(), options, valueNodeContext);

  registerNode(node);
  return observable;
}

function createObservableNode<T>(
  id: NodeId,
  options: ObservableOptions<T>,
  context: ValueNodeContext,
): CreatedNode<Observable<T>> {
  const subscribers = new Map<Subscriber<T>, T>();
  let emittedState: EmittedState<T> = { kind: "empty" };
  let isSubscribed = false;
  let sourceUnsubscribe: Unsubscribe | undefined;
  let node: RuntimeNode;

  const emit = (value: T): void => {
    if (!isSubscribed) {
      return;
    }

    if (emittedState.kind === "ready" && Object.is(emittedState.value, value)) {
      return;
    }

    emittedState = {
      kind: "ready",
      value,
    };
    context.queueNotification(node);
    context.markObserversDirty(id);
    context.scheduleFlush();
  };

  const readValue = (): T => {
    if (isSubscribed && emittedState.kind === "ready") {
      return emittedState.value;
    }

    return options.get();
  };

  const startSubscription = (): void => {
    if (isSubscribed) {
      return;
    }

    isSubscribed = true;

    try {
      sourceUnsubscribe = options.subscribe(emit);
    } catch (error) {
      isSubscribed = false;
      emittedState = { kind: "empty" };
      throw error;
    }
  };

  const stopSubscription = (): void => {
    if (!isSubscribed) {
      return;
    }

    const unsubscribe = sourceUnsubscribe;

    isSubscribed = false;
    sourceUnsubscribe = undefined;
    emittedState = { kind: "empty" };
    unsubscribe?.();
  };

  const syncSubscription = (forceSubscribe = false): void => {
    const shouldSubscribe = forceSubscribe || subscribers.size > 0 || node.observers.size > 0;

    if (shouldSubscribe) {
      startSubscription();
      return;
    }

    stopSubscription();
  };

  const observable: Observable<T> = {
    id,
    get: () => {
      const isTracked = context.recordDependency(id);

      if (isTracked) {
        syncSubscription(true);
      }

      return readValue();
    },
    peek: () => readValue(),
    subscribe: (subscriber) => {
      syncSubscription(true);
      subscribers.set(subscriber, readValue());

      return () => {
        subscribers.delete(subscriber);
        syncSubscription();
      };
    },
  };

  node = {
    id,
    kind: "observable",
    observable,
    dependencies: new Set(),
    observers: new Set(),
    dirty: false,
    hasSubscribers: () => subscribers.size > 0,
    ensureFresh: () => {},
    notifySubscribers: () => {
      const value = readValue();

      for (const [subscriber, previousValue] of Array.from(subscribers.entries())) {
        if (!subscribers.has(subscriber) || Object.is(previousValue, value)) {
          continue;
        }

        subscribers.set(subscriber, value);
        subscriber(value, previousValue);
      }
    },
    syncSubscription,
  };

  return {
    observable,
    node,
  };
}
