import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `src/**` is the app; `tests/playwright/**` lets the template-marathon
    // harness ship CI-gated unit tests for its pure fixture logic (the
    // marathon run itself needs a live app and can't be a per-PR gate).
    include: ["src/**/*.test.{ts,tsx}", "tests/playwright/**/*.test.ts"],
  },
});
