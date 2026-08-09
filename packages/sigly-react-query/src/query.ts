import { QueryObserver } from "@tanstack/query-core";
import type {
  DefaultError,
  QueryClient,
  QueryKey,
  QueryObserverOptions,
  QueryObserverResult,
} from "@tanstack/query-core";
import { observable$ } from "sigly";
import type { Observable } from "sigly";

export type QueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>;

export type QueryResult<TData = unknown, TError = DefaultError> = QueryObserverResult<
  TData,
  TError
>;

export type QueryObservable<TData = unknown, TError = DefaultError> = Observable<
  QueryResult<TData, TError>
>;

export function query<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryClient: QueryClient,
  options: QueryOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
): QueryObservable<TData, TError> {
  const defaultedOptions = queryClient.defaultQueryOptions(options);
  const observer = new QueryObserver(queryClient, defaultedOptions);

  return observable$({
    get: () => observer.getOptimisticResult(defaultedOptions),
    subscribe: (emit) => observer.subscribe(emit),
  });
}
