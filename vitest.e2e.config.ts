import { defineConfig } from 'vitest/config';
import path from 'path';
import CliE2eReporter from './src/test/e2e/cli-e2e-reporter';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/e2e/cli-*.e2e.test.{ts,tsx}'],
    reporters: ['default', new CliE2eReporter()],
  },
});
