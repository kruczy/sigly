# Sigly

Sigly is a pnpm monorepo.

## Getting Started

Install dependencies:

```sh
pnpm install
```

Run package scripts across the workspace:

```sh
pnpm -r run build
```

Start the Sigly playground app:

```sh
pnpm playground
```

## Packages

- `sigly` - the main package, located in `packages/sigly`

## Effects

Use `effect` to run a side effect immediately and rerun it whenever an observable
read through `get()` changes:

```ts
import { effect, value$ } from "sigly";

const count = value$(0);

const cancel = effect(() => {
  console.log(`Count: ${count.get()}`);
});

count.set(1);
cancel();
```

Dependency changes are batched, so an effect reruns once on the next microtask even
when multiple dependencies change synchronously. Dependencies are collected again
on every run, allowing conditional dependencies to change. Reads through `peek()`
are not tracked. Call the returned function to prevent future runs, including a run
that is already scheduled but has not started.

## Apps

- `playground` - a CodeMirror-powered browser playground for trying Sigly, located in `apps/playground`

## License

MIT
