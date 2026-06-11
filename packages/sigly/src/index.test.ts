import { describe, expect, it } from "vitest";

import { greet, name } from "./index.js";

describe("sigly", () => {
  it("exports the package name", () => {
    expect(name).toBe("sigly");
  });

  it("greets a subject", () => {
    expect(greet("tests")).toBe("Hello, tests from sigly.");
  });
});
