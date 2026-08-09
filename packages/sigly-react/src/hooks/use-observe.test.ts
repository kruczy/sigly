// @vitest-environment happy-dom

import { createElement, type DependencyList } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { computed$, observable$, value$ } from "../../../sigly/src/index.js";
import type { Observable, Subscriber } from "../../../sigly/src/index.js";

import { useObserve } from "./use-observe.js";

type ReactActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

(globalThis as ReactActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const roots = new Set<Root>();

const nextMicrotask = (): Promise<void> =>
  new Promise((resolve) => {
    queueMicrotask(resolve);
  });

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount();
    });
  }

  roots.clear();
  document.body.replaceChildren();
});

describe("useObserve", () => {
  it("runs the callback when a value observable changes", async () => {
    const count = value$(1);
    const calls: [value: number, previousValue: number][] = [];

    renderObserver({
      callback: (value, previousValue) => {
        calls.push([value, previousValue]);
      },
      deps: [],
      observable: count,
    });

    expect(calls).toEqual([]);

    await act(async () => {
      count.set(2);
      await nextMicrotask();
    });

    expect(calls).toEqual([[2, 1]]);
  });

  it("observes computed values through their dependencies", async () => {
    const count = value$(2);
    const doubled = computed$(() => count.get() * 2);
    const calls: [value: number, previousValue: number][] = [];

    renderObserver({
      callback: (value, previousValue) => {
        calls.push([value, previousValue]);
      },
      deps: [],
      observable: doubled,
    });

    await act(async () => {
      count.set(5);
      await nextMicrotask();
    });

    expect(calls).toEqual([[10, 4]]);
  });

  it("cleans up the observable subscription on unmount", async () => {
    let emit: ((value: number) => void) | undefined;
    let unsubscribeCalls = 0;
    const calls: [value: number, previousValue: number][] = [];

    const source = observable$({
      get: () => 1,
      subscribe: (nextEmit) => {
        emit = nextEmit;

        return () => {
          unsubscribeCalls += 1;
          emit = undefined;
        };
      },
    });
    const view = renderObserver({
      callback: (value, previousValue) => {
        calls.push([value, previousValue]);
      },
      deps: [],
      observable: source,
    });

    act(() => {
      view.unmount();
    });

    expect(unsubscribeCalls).toBe(1);
    expect(emit).toBeUndefined();

    await act(async () => {
      emit?.(2);
      await nextMicrotask();
    });

    expect(calls).toEqual([]);
  });

  it("resubscribes when the observable source changes", async () => {
    const first = value$(1);
    const second = value$(10);
    const calls: [value: number, previousValue: number][] = [];
    const view = renderObserver({
      callback: (value, previousValue) => {
        calls.push([value, previousValue]);
      },
      deps: [],
      observable: first,
    });

    act(() => {
      view.render({
        callback: (value, previousValue) => {
          calls.push([value, previousValue]);
        },
        deps: [],
        observable: second,
      });
    });

    await act(async () => {
      first.set(2);
      await nextMicrotask();
    });

    expect(calls).toEqual([]);

    await act(async () => {
      second.set(11);
      await nextMicrotask();
    });

    expect(calls).toEqual([[11, 10]]);
  });

  it("uses the dependency list to refresh the callback closure", async () => {
    const count = value$(1);
    const calls: number[] = [];
    let multiplier = 2;
    const view = renderObserver({
      callback: (value) => {
        calls.push(value * multiplier);
      },
      deps: [multiplier],
      observable: count,
    });

    await act(async () => {
      count.set(2);
      await nextMicrotask();
    });

    multiplier = 3;

    act(() => {
      view.render({
        callback: (value) => {
          calls.push(value * multiplier);
        },
        deps: [multiplier],
        observable: count,
      });
    });

    await act(async () => {
      count.set(3);
      await nextMicrotask();
    });

    expect(calls).toEqual([4, 9]);
  });
});

type ObserveProps = {
  readonly callback: Subscriber<number>;
  readonly deps: DependencyList;
  readonly observable: Observable<number>;
};

function renderObserver(props: ObserveProps): {
  readonly render: (nextProps: ObserveProps) => void;
  readonly unmount: () => void;
} {
  const host = document.createElement("div");
  const root = createRoot(host);

  document.body.append(host);
  roots.add(root);

  const render = (nextProps: ObserveProps): void => {
    root.render(createElement(ObserveProbe, nextProps));
  };

  act(() => {
    render(props);
  });

  return {
    render: (nextProps) => {
      render(nextProps);
    },
    unmount: () => {
      root.unmount();
      roots.delete(root);
    },
  };
}

function ObserveProbe({ callback, deps, observable }: ObserveProps) {
  useObserve(observable, callback, deps);

  return null;
}
