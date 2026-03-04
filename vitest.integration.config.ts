import { defineConfig } from 'vitest/config';
import path from 'path';
import IntegrationReporter from './src/test/integration/integration-reporter';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/integration/rounds/*.integration.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    reporters: ['default', new IntegrationReporter()],
    pool: 'forks',
    maxForks: 1,
    fileParallelism: false,
  },
});
