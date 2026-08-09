import { createNodeId, registerNode, valueNodeContext } from "./registry.js";
import type { Observable, ObservableOptions } from "./types.js";
import type {
  CreatedNode,
  NodeId,
  RuntimeNode,
  RuntimeSource,
  ValueNodeContext,
} from "./runtime.js";

type EmittedState<T> =
  | {
      readonly ready: false;
    }
  | {
      readonly ready: true;
      readonly value: T;
    };

type CreatedObservableNode<T> = CreatedNode<Observable<T>> & {
  readonly source: RuntimeSource;
};

export function observable$<T>(options: ObservableOptions<T>): Observable<T> {
  const { observable, node, source } = createObservableNode(
    createNodeId(),
    options,
    valueNodeContext,
  );

  registerNode(node, source);
  return observable;
}

function createObservableNode<T>(
  id: NodeId,
  options: ObservableOptions<T>,
  context: ValueNodeContext,
): CreatedObservableNode<T> {
  let emittedState: EmittedState<T> = { ready: false };
  let node: RuntimeNode;

  const emit = (value: T): void => {
    if (
      !context.isSourceActive(node) ||
      (emittedState.ready && Object.is(emittedState.value, value))
    ) {
      return;
    }

    emittedState = { ready: true, value };
    context.queueNotification(node);
    context.markObserversDirty(id);
    context.scheduleFlush();
  };

  const readValue = (): T => {
    if (context.isSourceActive(node) && emittedState.ready) {
      return emittedState.value;
    }

    return options.get();
  };

  const observable: Observable<T> = {
    id,
    get: () => {
      const isTracked = context.recordDependency(id);

      if (isTracked) {
        context.activateSource(node);
      }

      return readValue();
    },
    peek: readValue,
    subscribe: (subscriber) => context.subscribe(node, subscriber, readValue),
  };

  node = {
    id,
    kind: "observable",
    observable,
    dependencies: new Map(),
    observers: new Set(),
    dirty: false,
    ensureFresh: () => {},
  };

  return {
    observable,
    node,
    source: {
      reset: () => {
        emittedState = { ready: false };
      },
      subscribe: () => options.subscribe(emit),
    },
  };
}
