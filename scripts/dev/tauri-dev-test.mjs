#!/usr/bin/env node
// Launch `tauri dev` for the lite + test-automation build, deriving Tauri's
// `devUrl` from PERSONAS_VITE_PORT so a SECOND, parallel instance loads its own
// Vite frontend instead of the default :1420 one.
//
// Why this exists: `vite.config.ts` already honors PERSONAS_VITE_PORT (a second
// instance serves its frontend on, e.g., :1430), but `tauri.conf.json` hardcodes
// `devUrl: http://localhost:1420`. Without this, a parallel `tauri:dev:test`
// instance pairs its OWN backend with the DEFAULT instance's frontend — which
// silently breaks GUI/E2E driving of worktree changes. Pairs with
// PERSONAS_TEST_PORT (test-automation HTTP server) + PERSONAS_DATA_DIR (isolated
// DB) for fully isolated parallel instances.
//
// PERSONAS_VITE_PORT unset → devUrl :1420, byte-for-byte the prior behavior.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LITE_CONFIG = 'src-tauri/tauri.lite.conf.json';
const port = Number(process.env.PERSONAS_VITE_PORT) || 1420;

const lite = JSON.parse(readFileSync(LITE_CONFIG, 'utf8'));
const merged = {
  ...lite,
  build: { ...(lite.build ?? {}), devUrl: `http://localhost:${port}` },
};

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['tauri', 'dev', '--config', JSON.stringify(merged), '--', '--features', 'test-automation'];

// No shell → the inline JSON `--config` arg is passed as a single argv entry,
// avoiding cross-platform quoting pitfalls.
const child = spawn(npx, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to launch tauri dev:', err);
  process.exit(1);
});
