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
- `sigly-react` - React bindings, located in `packages/sigly-react`
- `sigly-react-query` - TanStack Query bindings, located in `packages/sigly-react-query`

## Releasing

Prepare a patch release from a clean working tree:

```sh
pnpm release:prepare
```

The command compares each public package with its latest `<package>@<version>` Git
tag, selects only changed packages (and packages that have never been released),
bumps their versions, and writes `.release/plan.json`. Use `minor` or `major` as an
argument when needed, or add `--dry-run` to preview the plan. Review and commit the
generated package manifest and release-plan changes.

Build and publish that committed plan later:

```sh
pnpm release:publish --dry-run
pnpm release:publish
```

Packages are built and published serially in dependency order. Existing npm
versions are skipped so an interrupted release can be resumed. A successful
publish creates one Git tag per package and immediately pushes it to `origin`.
If that push fails after npm succeeds, rerun the publish command; it skips the
existing npm version and retries the tag push. Future preparation runs use those
tags as independent baselines.

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
