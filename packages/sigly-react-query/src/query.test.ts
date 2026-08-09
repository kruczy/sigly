import { QueryClient } from "@tanstack/query-core";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { query } from "./query.js";
import type { QueryObservable, QueryOptions, QueryResult } from "./query.js";

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe("query", () => {
  it("does not fetch until the observable is subscribed", async () => {
    const queryClient = createQueryClient();
    const queryFn = vi.fn<() => Promise<string>>(async () => "hello");
    const observable = query(queryClient, {
      queryKey: ["greeting"],
      queryFn,
    });

    expect(observable.peek()).toMatchObject({
      data: undefined,
      fetchStatus: "idle",
      status: "pending",
    });
    expect(queryFn).not.toHaveBeenCalled();

    const unsubscribe = observable.subscribe(() => {});

    await vi.waitFor(() => {
      expect(observable.get()).toMatchObject({
        data: "hello",
        fetchStatus: "idle",
        status: "success",
      });
    });
    expect(queryFn).toHaveBeenCalledOnce();

    unsubscribe();
  });

  it("emits query result updates and detaches the observer on unsubscribe", async () => {
    const queryClient = createQueryClient();
    const queryKey = ["count"] as const;
    const observable = query(queryClient, {
      enabled: false,
      initialData: 1,
      queryKey,
      queryFn: async () => 2,
    });
    const values: number[] = [];

    const unsubscribe = observable.subscribe((result) => {
      if (result.data !== undefined) {
        values.push(result.data);
      }
    });

    expect(queryClient.getQueryCache().find({ queryKey })?.getObserversCount()).toBe(1);

    queryClient.setQueryData(queryKey, 3);

    await vi.waitFor(() => {
      expect(values).toEqual([3]);
    });

    unsubscribe();

    expect(queryClient.getQueryCache().find({ queryKey })?.getObserversCount()).toBe(0);
  });

  it("reads fresh cached data while it has no subscribers", () => {
    const queryClient = createQueryClient();
    const queryKey = ["cached-count"] as const;
    const observable = query(queryClient, {
      enabled: false,
      queryKey,
      queryFn: async () => 1,
    });

    expect(observable.peek().data).toBeUndefined();

    queryClient.setQueryData(queryKey, 4);

    expect(observable.peek().data).toBe(4);
  });

  it("supports observer options and infers selected data", () => {
    const queryClient = createQueryClient();
    const options = {
      enabled: false,
      initialData: { count: 2 },
      queryKey: ["selected-count"] as const,
      queryFn: async () => ({ count: 3 }),
      select: (data: { count: number }) => String(data.count),
      staleTime: 1_000,
    } satisfies QueryOptions<{ count: number }, Error, string>;
    const observable = query(queryClient, options);

    expectTypeOf(observable).toEqualTypeOf<QueryObservable<string>>();
    expectTypeOf(observable.peek()).toEqualTypeOf<QueryResult<string>>();
    expect(observable.peek().data).toBe("2");
  });
});
