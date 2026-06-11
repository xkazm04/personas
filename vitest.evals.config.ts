import { defineConfig } from 'vitest/config';

// D8 eval harness — contract/golden tests over the agent & prompt library (`evals/`). Uses the
// repo's existing Vitest, not a separate eval tool. Run: `npm run test:evals` (pre-push runs it too).
// Pure Node, no app/DB/aliases — same lane as the CLI eval config.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['evals/**/*.{eval.test,golden.test,test}.ts'],
    testTimeout: 30_000,
  },
});
