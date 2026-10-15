import { defineConfig, configDefaults } from "vitest/config";
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
    // The default lane's boundary is explicit, like every other lane's: the
    // CLI e2e files under `src/test/e2e/` end in `.test.ts` and were therefore
    // matched here as well as by `vitest.e2e.config.ts`. Two configs claiming
    // one file means it runs twice, under whichever budget and reporter the
    // lane it happened to be started from carries. They belong to the e2e lane.
    exclude: [...configDefaults.exclude, "src/test/e2e/**"],
    // `vitest --changed` (CI's fast lane, `npm run verify:affected`) follows
    // imports from a changed file to the tests that reach it. The setup file
    // and the shared test helpers are reached by every test but imported by
    // none of them through that graph, so an edit there would select ZERO
    // tests. Any change under src/test/ runs the whole suite instead.
    forceRerunTriggers: [...configDefaults.forceRerunTriggers, "**/src/test/**"],
  },
});
