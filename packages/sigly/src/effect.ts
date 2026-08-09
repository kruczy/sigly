import { computed$ } from "./computed.js";
import type { Unsubscribe } from "./types.js";

/**
 * Runs a callback immediately and again when an observable read through `get()` changes.
 *
 * Reruns are batched on the next microtask. The returned function cancels the effect.
 */
export const effect = (callback: () => void): Unsubscribe => {
  const computed = computed$(callback);
  return computed.subscribe(() => {});
};
