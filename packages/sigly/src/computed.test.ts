import { describe, expect, it } from "vitest";

import { computed$ } from "./computed.js";
import { track } from "./registry.js";
import { value$ } from "./value.js";

const nextMicrotask = (): Promise<void> =>
  new Promise((resolve) => {
    queueMicrotask(resolve);
  });

describe("computed$", () => {
  it("tracks dependencies through get and recomputes subscribed nodes on the next microtask", async () => {
    const first = value$(1);
    const second = value$(2);
    const calls: [value: number, previousValue: number][] = [];
    let runs = 0;

    const total = computed$(() => {
      runs += 1;
      return first.get() + second.get();
    });

    expect(runs).toBe(0);
    expect(total.peek()).toBe(3);
    expect(total.peek()).toBe(3);
    expect(runs).toBe(1);

    total.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    first.set(3);

    expect(runs).toBe(1);
    expect(calls).toEqual([]);

    await nextMicrotask();

    expect(runs).toBe(2);
    expect(calls).toEqual([[5, 3]]);
  });

  it("keeps unobserved computed nodes lazy until they are read", async () => {
    const count = value$(1);
    let runs = 0;

    const doubled = computed$(() => {
      runs += 1;
      return count.get() * 2;
    });

    expect(doubled.peek()).toBe(2);
    expect(runs).toBe(1);

    count.set(2);
    await nextMicrotask();

    expect(runs).toBe(1);
    expect(doubled.peek()).toBe(4);
    expect(runs).toBe(2);
  });

  it("recomputes dependency chains for subscribed downstream computed nodes", async () => {
    const count = value$(1);
    const calls: [value: number, previousValue: number][] = [];
    let doubledRuns = 0;
    let totalRuns = 0;

    const doubled = computed$(() => {
      doubledRuns += 1;
      return count.get() * 2;
    });

    const total = computed$(() => {
      totalRuns += 1;
      return doubled.get() + 1;
    });

    total.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    count.set(2);

    expect(doubledRuns).toBe(1);
    expect(totalRuns).toBe(1);

    await nextMicrotask();

    expect(doubledRuns).toBe(2);
    expect(totalRuns).toBe(2);
    expect(calls).toEqual([[5, 3]]);
  });

  it("refreshes a dirty computed dependency before returning it to another compute", async () => {
    const count = value$(1);
    const events: string[] = [];
    const calls: [value: number, previousValue: number][] = [];

    const doubled = computed$(() => {
      const value = count.get() * 2;
      events.push(`doubled:${value}`);
      return value;
    });

    const summary = computed$(() => {
      events.push("summary:start");
      const value = doubled.get();
      events.push(`summary:after-doubled:${value}`);
      return value + 1;
    });

    summary.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    expect(events).toEqual(["summary:start", "doubled:2", "summary:after-doubled:2"]);

    events.length = 0;
    count.set(2);

    await nextMicrotask();

    expect(events).toEqual(["summary:start", "doubled:4", "summary:after-doubled:4"]);
    expect(calls).toEqual([[5, 3]]);
  });

  it("refreshes a shared dirty computed once across a diamond dependency graph", async () => {
    const count = value$(1);
    const calls: [value: number, previousValue: number][] = [];
    let doubledRuns = 0;
    let leftRuns = 0;
    let rightRuns = 0;
    let totalRuns = 0;

    const doubled = computed$(() => {
      doubledRuns += 1;
      return count.get() * 2;
    });

    const left = computed$(() => {
      leftRuns += 1;
      return doubled.get() + 1;
    });

    const right = computed$(() => {
      rightRuns += 1;
      return doubled.get() + 10;
    });

    const total = computed$(() => {
      totalRuns += 1;
      return left.get() + right.get();
    });

    total.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    expect(total.peek()).toBe(15);
    expect(doubledRuns).toBe(1);
    expect(leftRuns).toBe(1);
    expect(rightRuns).toBe(1);
    expect(totalRuns).toBe(1);

    count.set(2);

    await nextMicrotask();

    expect(calls).toEqual([[19, 15]]);
    expect(doubledRuns).toBe(2);
    expect(leftRuns).toBe(2);
    expect(rightRuns).toBe(2);
    expect(totalRuns).toBe(2);
  });

  it("updates dependencies when a computed branch changes", async () => {
    const usePrimary = value$(true);
    const primary = value$(1);
    const fallback = value$(10);
    const calls: [value: number, previousValue: number][] = [];
    let runs = 0;

    const selected = computed$(() => {
      runs += 1;

      if (usePrimary.get()) {
        return primary.get();
      }

      return fallback.get();
    });

    selected.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    expect(runs).toBe(1);

    fallback.set(20);
    await nextMicrotask();

    expect(runs).toBe(1);
    expect(calls).toEqual([]);

    usePrimary.set(false);
    await nextMicrotask();

    expect(runs).toBe(2);
    expect(calls).toEqual([[20, 1]]);

    primary.set(2);
    await nextMicrotask();

    expect(runs).toBe(2);
    expect(calls).toEqual([[20, 1]]);

    fallback.set(30);
    await nextMicrotask();

    expect(runs).toBe(3);
    expect(calls).toEqual([
      [20, 1],
      [30, 20],
    ]);
  });

  it("does not create dependencies through peek", async () => {
    const tracked = value$(1);
    const untracked = value$(10);
    const calls: [value: number, previousValue: number][] = [];

    const selected = computed$(() => tracked.get() + untracked.peek());

    selected.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    untracked.set(20);
    await nextMicrotask();

    expect(calls).toEqual([]);

    tracked.set(2);
    await nextMicrotask();

    expect(calls).toEqual([[22, 11]]);
  });

  it("does not track dependencies read by a peeked computed", () => {
    const tracked = value$(1);
    const untracked = value$(10);
    let peekedRuns = 0;

    const peeked = computed$(() => {
      peekedRuns += 1;
      return untracked.get() * 2;
    });

    const result = track(() => tracked.get() + peeked.peek());

    expect(result.value).toBe(21);
    expect(result.dependencies.map((dependency) => dependency.observable)).toEqual([tracked]);
    expect(result.dependencies.map((dependency) => dependency.kind)).toEqual(["value"]);
    expect(peekedRuns).toBe(1);
  });

  it("does not track a peeked computed", () => {
    const source = value$(10);
    let peekedRuns = 0;

    const peeked = computed$(() => {
      peekedRuns += 1;
      return source.get() * 2;
    });

    const result = track(() => peeked.peek());

    expect(result.value).toBe(20);
    expect(result.dependencies).toEqual([]);
    expect(peekedRuns).toBe(1);
  });

  it("tracks only the computed read through get", () => {
    const source = value$(10);
    let innerRuns = 0;
    let outerRuns = 0;

    const inner = computed$(() => {
      innerRuns += 1;
      return source.get() * 2;
    });

    const outer = computed$(() => {
      outerRuns += 1;
      return inner.get() + 1;
    });

    const result = track(() => outer.get());

    expect(result.value).toBe(21);
    expect(result.dependencies.map((dependency) => dependency.observable)).toEqual([outer]);
    expect(result.dependencies.map((dependency) => dependency.kind)).toEqual(["computed"]);
    expect(innerRuns).toBe(1);
    expect(outerRuns).toBe(1);
  });

  it("does not notify when a recomputed value is unchanged", async () => {
    const count = value$(1);
    const calls: [value: number, previousValue: number][] = [];

    const parity = computed$(() => count.get() % 2);

    parity.subscribe((value, previousValue) => {
      calls.push([value, previousValue]);
    });

    count.set(3);
    await nextMicrotask();

    expect(calls).toEqual([]);
  });
});
