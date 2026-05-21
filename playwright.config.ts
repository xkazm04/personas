import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * Load `.env` into `process.env` before specs read it — no `dotenv`
 * dependency. Only fills keys that aren't already set, so a value passed
 * on the command line still wins. Used by the Discord E2E specs for
 * DISCORD_BOT_TOKEN / DISCORD_TEST_CHANNEL_ID / etc.
 */
function loadDotEnv(): void {
  if (!existsSync('.env')) return;
  for (const rawLine of readFileSync('.env', 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

/**
 * Playwright config for Athena E2E tests.
 *
 * Architecture note: these tests do NOT launch a browser. They drive a
 * *real* running Tauri app via the test-automation HTTP server on
 * port 17320 (`tauri-driver`-via-WebDriver is too brittle on Windows).
 * Playwright is used here as a TS test runner — `expect()`, parallel
 * execution, HTML reporter, retry logic — with the actual UI/IPC
 * driven by `tests/playwright/companion-bridge.ts`.
 *
 * Pre-req: start the app first with
 *   npm run tauri:dev:test
 * The suite expects the app to be reachable at 127.0.0.1:17320 and
 * fails the `health()` check in beforeAll if it isn't.
 *
 * Set `COMPANION_TEST_PORT=17321` to point at a production install
 * that was launched with `PERSONAS_TEST_PORT=17321`.
 */
export default defineConfig({
  testDir: './tests/playwright',
  // Most tests round-trip through real Claude Opus calls (30-90s each).
  // The full conversation suite takes ~5 minutes.
  timeout: 360_000,
  // Workers must stay at 1 — both shapes share the same companion
  // session (singleton on the backend), so parallelism would corrupt
  // the transcript ordering.
  workers: 1,
  // Don't auto-retry: a real-Claude failure usually has a real cause.
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    // Bridge URL is read from `COMPANION_TEST_PORT` inside the harness;
    // we don't use Playwright's `baseURL` because we're not launching a
    // browser context.
    actionTimeout: 30_000,
  },
});
