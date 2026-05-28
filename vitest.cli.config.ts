import { defineConfig } from 'vitest/config';

// Node-lane test config for the team-autonomy eval harness (`scripts/test/`).
// Cloned from vitest.integration.config.ts — these are fast, pure-function unit
// tests over the extracted `scripts/test/lib/` modules (verdict caps, grounding,
// git helpers, sustain, schema contract). No app, no DB, no aliases.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/cli/**/*.test.mjs'],
    testTimeout: 30_000,
    pool: 'forks',
    maxForks: 1,
    fileParallelism: false,
  },
});
