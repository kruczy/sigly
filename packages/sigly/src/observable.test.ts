import { describe, expect, it } from "vitest";

import { computed$ } from "./computed.js";
import { observable$ } from "./observable.js";
import { track } from "./registry.js";
import { value$ } from "./value.js";

const nextMicrotask = (): Promise<void> =>
  new Promise((resolve) => {
    queueMicrotask(resolve);
  });

describe("observable$", () => {
  it("reads the current value without subscribing to the source", () => {
    let value = 1;
    let subscribeCalls = 0;

    const source = observable$({
      get: () => value,
      subscribe: () => {
        subscribeCalls += 1;
        return () => {};
      },
    });

    expect(source.peek()).toBe(1);

    value = 2;

    expect(source.get()).toBe(2);
    expect(subscribeCalls).toBe(0);
  });

  it("does not subscribe when peek is read in a tracked context", () => {
    let getCalls = 0;
    let subscribeCalls = 0;

    const source = observable$({
      get: () => {
        getCalls += 1;
        return 1;
      },
      subscribe: () => {
        subscribeCalls += 1;
        return () => {};
      },
    });

    const result = track(() => source.peek() + 1);

    expect(result.value).toBe(2);
    expect(result.dependencies).toEqual([]);
    expect(getCalls).toBe(1);
    expect(subscribeCalls).toBe(0);
  });

  it("does not subscribe to a source peeked by a subscribed computed", () => {
    let getCalls = 0;
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    let runs = 0;

    const source = observable$({
      get: () => {
        getCalls += 1;
        return 1;
      },
      subscribe: () => {
        subscribeCalls += 1;

        return () => {
          unsubscribeCalls += 1;
        };
      },
    });

    const plusOne = computed$(() => {
      runs += 1;
      return source.peek() + 1;
    });

    const unsubscribe = plusOne.subscribe(() => {});

    expect(runs).toBe(1);
    expect(getCalls).toBe(1);
    expect(subscribeCalls).toBe(0);

    unsubscribe();

    expect(unsubscribeCalls).toBe(0);
  });

  it("does not subscribe when a computed gets the source in an untracked context", () => {
    let getCalls = 0;
    let subscribeCalls = 0;
    let runs = 0;

    const source = observable$({
      get: () => {
        getCalls += 1;
        return 1;
      },
      subscribe: () => {
        subscribeCalls += 1;
        return () => {};
      },
    });

    const plusOne = computed$(() => {
      runs += 1;
      return source.get() + 1;
    });

    const result = plusOne.get();

    expect(result).toBe(2);
    expect(runs).toBe(1);
    expect(getCalls).toBe(1);
    expect(subscribeCalls).toBe(0);
  });

  it("does not subscribe when a peeked computed gets the source in a tracked context", () => {
    let getCalls = 0;
    let subscribeCalls = 0;
    let runs = 0;

    const source = observable$({
      get: () => {
        getCalls += 1;
        return 1;
      },
      subscribe: () => {
        subscribeCalls += 1;
        return () => {};
      },
    });

    const plusOne = computed$(() => {
      runs += 1;
      return source.get() + 1;
    });

    const result = track(() => plusOne.peek() + 1);

    expect(result.value).toBe(3);
    expect(result.dependencies).toEqual([]);
    expect(runs).toBe(1);
    expect(getCalls).toBe(1);
    expect(subscribeCalls).toBe(0);
  });

  it("uses the provided subscribe behavior for direct subscribers", async () => {
    let fallbackValue = 1;
    let emit: ((value: number) => void) | undefined;
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    const calls: [value: number, previousValue: number][] = [];

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

    const unsubscribe = source.subscribe((nextValue, previousValue) => {
      calls.push([nextValue, previousValue]);
    });

    expect(subscribeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);

    emit?.(2);

    expect(calls).toEqual([]);

    await nextMicrotask();

    expect(calls).toEqual([[2, 1]]);

    emit?.(3);
    emit?.(4);

    await nextMicrotask();

    expect(calls).toEqual([
      [2, 1],
      [4, 2],
    ]);

    unsubscribe();

    expect(unsubscribeCalls).toBe(1);
    expect(emit).toBeUndefined();

    fallbackValue = 5;

    expect(source.peek()).toBe(5);
  });

  it("returns a synchronous emitted value from a tracked get", () => {
    let getCalls = 0;
    let subscribeCalls = 0;

    const source = observable$({
      get: () => {
        getCalls += 1;
        return 1;
      },
      subscribe: (emit) => {
        subscribeCalls += 1;
        emit(5);

        return () => {};
      },
    });

    const plusOne = computed$(() => source.get() + 1);

    expect(plusOne.peek()).toBe(6);
    expect(subscribeCalls).toBe(1);
    expect(getCalls).toBe(0);
  });

  it("invalidates subscribed computed observers when the source emits", async () => {
    let fallbackValue = 1;
    let getCalls = 0;
    let emit: ((value: number) => void) | undefined;
    let subscribeCalls = 0;
    const calls: [value: number, previousValue: number][] = [];

    const source = observable$({
      get: () => {
        getCalls += 1;
        return fallbackValue;
      },
      subscribe: (nextEmit) => {
        subscribeCalls += 1;
        emit = nextEmit;

        return () => {
          emit = undefined;
        };
      },
    });

    const plusOne = computed$(() => source.get() + 1);

    plusOne.subscribe((nextValue, previousValue) => {
      calls.push([nextValue, previousValue]);
    });

    expect(subscribeCalls).toBe(1);
    expect(getCalls).toBe(1);

    emit?.(2);

    expect(calls).toEqual([]);

    await nextMicrotask();

    expect(calls).toEqual([[3, 2]]);
    expect(getCalls).toBe(1);

    fallbackValue = 100;
    emit?.(4);

    await nextMicrotask();

    expect(calls).toEqual([
      [3, 2],
      [5, 3],
    ]);
    expect(getCalls).toBe(1);
  });

  it("unsubscribes from the source when a computed branch stops reading it", async () => {
    let fallbackValue = 1;
    let emit: ((value: number) => void) | undefined;
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    let runs = 0;
    const useSource = value$(true);
    const fallback = value$(10);
    const calls: [value: number, previousValue: number][] = [];

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

    const selected = computed$(() => {
      runs += 1;

      if (useSource.get()) {
        return source.get();
      }

      return fallback.get();
    });

    selected.subscribe((nextValue, previousValue) => {
      calls.push([nextValue, previousValue]);
    });

    expect(runs).toBe(1);
    expect(subscribeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);

    useSource.set(false);
    await nextMicrotask();

    expect(runs).toBe(2);
    expect(subscribeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(1);
    expect(emit).toBeUndefined();
    expect(calls).toEqual([[10, 1]]);

    fallbackValue = 2;
    emit?.(99);
    await nextMicrotask();

    expect(runs).toBe(2);
    expect(calls).toEqual([[10, 1]]);

    useSource.set(true);
    await nextMicrotask();

    expect(runs).toBe(3);
    expect(subscribeCalls).toBe(2);
    expect(unsubscribeCalls).toBe(1);
    expect(calls).toEqual([
      [10, 1],
      [2, 10],
    ]);
  });
});
