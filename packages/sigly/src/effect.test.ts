import { describe, expect, it } from "vitest";

import { effect } from "./effect.js";
import { value$ } from "./value.js";

const nextMicrotask = (): Promise<void> =>
  new Promise((resolve) => {
    queueMicrotask(resolve);
  });

describe("effect", () => {
  it("runs immediately and reruns when a dependency changes", async () => {
    const first = value$(1);
    const second = value$(2);
    const values: number[] = [];

    effect(() => {
      values.push(first.get() + second.get());
    });

    expect(values).toEqual([3]);

    first.set(3);
    second.set(4);

    expect(values).toEqual([3]);

    await nextMicrotask();

    expect(values).toEqual([3, 7]);
  });

  it("updates its dependencies after each run", async () => {
    const usePrimary = value$(true);
    const primary = value$(1);
    const fallback = value$(10);
    const values: number[] = [];

    effect(() => {
      values.push(usePrimary.get() ? primary.get() : fallback.get());
    });

    fallback.set(20);
    await nextMicrotask();
    expect(values).toEqual([1]);

    usePrimary.set(false);
    await nextMicrotask();
    expect(values).toEqual([1, 20]);

    primary.set(2);
    expect(values).toEqual([1, 20]);
    await nextMicrotask();

    fallback.set(30);
    await nextMicrotask();
    expect(values).toEqual([1, 20, 30]);
  });

  it("does not track observables read through peek", async () => {
    const tracked = value$(1);
    const untracked = value$(10);
    const values: number[] = [];

    effect(() => {
      values.push(tracked.get() + untracked.peek());
    });

    untracked.set(20);
    await nextMicrotask();

    expect(values).toEqual([11]);

    tracked.set(2);
    await nextMicrotask();

    expect(values).toEqual([11, 22]);
  });

  it("stops rerunning after it is cancelled", async () => {
    const count = value$(0);
    const values: number[] = [];
    const cancel = effect(() => {
      values.push(count.get());
    });

    count.set(1);
    cancel();

    await nextMicrotask();

    expect(values).toEqual([0]);

    count.set(2);
    await nextMicrotask();

    expect(values).toEqual([0]);
  });
});
