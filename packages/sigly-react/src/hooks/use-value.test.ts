// @vitest-environment happy-dom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { computed$, observable$, value$ } from "../../../sigly/src/index.js";
import type { Observable } from "../../../sigly/src/index.js";

import { useValue } from "./use-value.js";

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

describe("useValue", () => {
  it("returns a value observable snapshot and rerenders after updates", async () => {
    const count = value$(1);
    const view = renderObservable(count);

    expect(view.host.textContent).toBe("1");

    await act(async () => {
      count.set(2);
      await nextMicrotask();
    });

    expect(view.host.textContent).toBe("2");
  });

  it("resolves computed observables through their dependencies", async () => {
    const count = value$(2);
    const doubled = computed$(() => count.get() * 2);
    const view = renderObservable(doubled);

    expect(view.host.textContent).toBe("4");

    await act(async () => {
      count.set(5);
      await nextMicrotask();
    });

    expect(view.host.textContent).toBe("10");
  });

  it("subscribes to observable sources and cleans them up on unmount", async () => {
    let fallbackValue = 1;
    let emit: ((value: number) => void) | undefined;
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;

    const source = observable$({
      get: () => fallbackValue,
      subscribe: (nextEmit) => {
        subscribeCalls += 1;
        emit = nextEmit;

        return () => {
          unsubscribeCalls += 1;
          emit = undefined;
        };
      },
    });
    const view = renderObservable(source);

    expect(view.host.textContent).toBe("1");
    expect(subscribeCalls).toBe(1);

    await act(async () => {
      emit?.(2);
      await nextMicrotask();
    });

    expect(view.host.textContent).toBe("2");

    act(() => {
      view.unmount();
    });

    expect(unsubscribeCalls).toBe(1);
    expect(emit).toBeUndefined();
  });

  it("resubscribes when the observable source changes", async () => {
    const first = value$("first");
    const second = value$("second");
    const view = renderObservable(first);

    expect(view.host.textContent).toBe("first");

    act(() => {
      view.render(second);
    });

    expect(view.host.textContent).toBe("second");

    await act(async () => {
      first.set("ignored");
      await nextMicrotask();
    });

    expect(view.host.textContent).toBe("second");

    await act(async () => {
      second.set("next");
      await nextMicrotask();
    });

    expect(view.host.textContent).toBe("next");
  });
});

function renderObservable<T>(observable: Observable<T>): {
  readonly host: HTMLElement;
  readonly render: (nextObservable: Observable<T>) => void;
  readonly unmount: () => void;
} {
  const host = document.createElement("div");
  const root = createRoot(host);

  document.body.append(host);
  roots.add(root);

  const render = (nextObservable: Observable<T>): void => {
    root.render(createElement(Probe, { observable: nextObservable }));
  };

  act(() => {
    render(observable);
  });

  return {
    host,
    render: (nextObservable) => {
      render(nextObservable);
    },
    unmount: () => {
      root.unmount();
      roots.delete(root);
    },
  };
}

function Probe<T>({ observable }: { readonly observable: Observable<T> }) {
  const value = useValue(observable);

  return createElement("span", undefined, String(value));
}
