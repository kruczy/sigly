import { describe, expect, it } from "vitest";

import { computed$ } from "./computed.js";
import { observable$ } from "./observable.js";
import type { Observable } from "./types.js";
import { value$ } from "./value.js";

type ExposedGcGlobal = typeof globalThis & {
  gc?: () => void;
};

const nextTurn = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function getExposedGc(): () => void {
  const gc = (globalThis as ExposedGcGlobal).gc;

  expect(gc).toBeTypeOf("function");

  if (typeof gc !== "function") {
    throw new TypeError("Expected the Vitest runner to expose global.gc.");
  }

  return gc;
}

async function expectCollected<T extends object>(weakRef: WeakRef<T>): Promise<void> {
  const gc = getExposedGc();

  await nextTurn();

  if (await collectWeakRef(weakRef, gc, 20)) {
    return;
  }

  expect(weakRef.deref()).toBeUndefined();
}

async function collectWeakRef<T extends object>(
  weakRef: WeakRef<T>,
  gc: () => void,
  attempts: number,
): Promise<boolean> {
  if (attempts === 0) {
    return false;
  }

  const pressure = new Uint8Array(1024 * 1024);
  pressure[0] = attempts;
  gc();
  await nextTurn();

  if (weakRef.deref() === undefined) {
    return true;
  }

  await nextTurn();

  return collectWeakRef(weakRef, gc, attempts - 1);
}

async function runGcTurns(turns: number): Promise<void> {
  if (turns === 0) {
    return;
  }

  getExposedGc()();
  await nextTurn();

  return runGcTurns(turns - 1);
}

describe("node lifetime", () => {
  it("allows an unreferenced value node to be garbage collected", async () => {
    expect.hasAssertions();

    const weakRef = (() => {
      const source = value$(1);
      return new WeakRef(source);
    })();

    await expectCollected(weakRef);
  });

  it("allows an unsubscribed computed node to be garbage collected", async () => {
    expect.hasAssertions();

    const weakRef = (() => {
      const source = value$(1);
      const doubled = computed$(() => source.get() * 2);
      const unsubscribe = doubled.subscribe(() => {});

      unsubscribe();

      return new WeakRef(doubled);
    })();

    await expectCollected(weakRef);
  });

  it("allows an unsubscribed observable node to be garbage collected", async () => {
    expect.hasAssertions();

    const weakRef = (() => {
      let value = 1;
      const source = observable$({
        get: () => value,
        subscribe: () => {
          return () => {
            value = 0;
          };
        },
      });
      const unsubscribe = source.subscribe(() => {});

      unsubscribe();

      return new WeakRef(source);
    })();

    await expectCollected(weakRef);
  });

  it("allows an unsubscribed computed observer of a live source to be garbage collected", async () => {
    expect.hasAssertions();

    const source = value$(1);
    const weakRef = (() => {
      const doubled = computed$(() => source.get() * 2);
      const unsubscribe = doubled.subscribe(() => {});

      unsubscribe();

      return new WeakRef(doubled);
    })();

    await expectCollected(weakRef);
    expect(source.peek()).toBe(1);
  });

  it("cleans up a collected computed observer when a live source emits", async () => {
    expect.hasAssertions();

    let emit: ((value: number) => void) | undefined;
    let unsubscribeCalls = 0;
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
    const weakRef = (() => {
      const doubled = computed$(() => source.get() * 2);
      const unsubscribe = doubled.subscribe(() => {});

      unsubscribe();

      return new WeakRef(doubled);
    })();

    expect(emit).toBeDefined();

    await expectCollected(weakRef);

    emit?.(2);

    expect(unsubscribeCalls).toBe(1);
    expect(emit).toBeUndefined();
  });

  it("keeps dependencies alive while a subscribed computed needs them", async () => {
    expect.hasAssertions();

    let source: Observable<number> | undefined = observable$({
      get: () => 1,
      subscribe: () => {
        return () => {};
      },
    });
    const sourceRef = new WeakRef(source);
    const doubled = computed$(() => source!.get() * 2);
    const unsubscribe = doubled.subscribe(() => {});

    source = undefined;

    await runGcTurns(5);

    expect(sourceRef.deref()).toBeDefined();

    unsubscribe();
  });
});
