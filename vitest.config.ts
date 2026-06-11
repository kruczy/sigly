import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: workspaceRoot,
  test: {
    clearMocks: true,
    environment: "node",
    globals: false,
    include: ["packages/*/src/**/*.test.ts"],
    passWithNoTests: false,
  },
});
