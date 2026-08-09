import assert from "node:assert/strict";
import test from "node:test";

import { bumpVersion, sortPackages } from "./release.mjs";

void test("bumps stable semantic versions", () => {
  assert.equal(bumpVersion("0.0.0"), "0.0.1");
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
});

void test("rejects prerelease and malformed versions", () => {
  assert.throws(() => bumpVersion("1.0.0-next.1"), /unsupported version/);
  assert.throws(() => bumpVersion("1.0"), /unsupported version/);
});

void test("sorts dependencies before dependents", () => {
  const packages = [
    { name: "adapter", internalDependencies: new Set(["core"]) },
    { name: "unrelated", internalDependencies: new Set() },
    { name: "core", internalDependencies: new Set() },
  ];
  const names = sortPackages(packages).map((pkg) => pkg.name);

  assert.ok(names.indexOf("core") < names.indexOf("adapter"));
  assert.deepEqual(new Set(names), new Set(["adapter", "core", "unrelated"]));
});

void test("detects internal dependency cycles", () => {
  assert.throws(
    () =>
      sortPackages([
        { name: "a", internalDependencies: new Set(["b"]) },
        { name: "b", internalDependencies: new Set(["a"]) },
      ]),
    /dependency cycle/,
  );
});
