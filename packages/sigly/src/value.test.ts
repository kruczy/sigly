import { describe, expect, it } from "vitest";

import { value$ } from "./value.js";

const nextMicrotask = (): Promise<void> =>
  new Promise((resolve) => {
    queueMicrotask(resolve);
  });

describe("value$", () => {
  it("stores values and notifies subscribers on the next microtask", async () => {
    const count = value$(1);
    const calls: [value: number, previousValue: number][] = [];

    const unsubscribe = count.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    expect(count.get()).toBe(1);
    expect(count.peek()).toBe(1);

    count.set(2);

    expect(count.get()).toBe(2);
    expect(calls).toEqual([]);

    await nextMicrotask();

    expect(calls).toEqual([[2, 1]]);

    unsubscribe();
    count.set(3);
    await nextMicrotask();

    expect(calls).toEqual([[2, 1]]);
  });

  it("batches multiple sets into one subscriber call with the final value", async () => {
    const count = value$(0);
    const calls: [value: number, previousValue: number][] = [];

    count.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    count.set(1);
    count.set(2);
    count.set(3);

    await nextMicrotask();

    expect(calls).toEqual([[3, 0]]);
  });
});
