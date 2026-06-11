import { describe, expect, it } from "vitest";

import * as sigly from "./index.js";

describe("public exports", () => {
  it("exports constructors without exposing the registry", () => {
    expect(sigly).toHaveProperty("value$");
    expect(sigly).toHaveProperty("computed$");
    expect(sigly).not.toHaveProperty("registry");
    expect(sigly).not.toHaveProperty("Registry");
  });
});
