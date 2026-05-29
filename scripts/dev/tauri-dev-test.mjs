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
//
// Implementation: the merged config is written to a temp file and passed to
// `--config` by PATH (not inline JSON). Two reasons:
//   1. `shell: true` is REQUIRED on Node >=20 / Windows to spawn `npx` (a
//      `.cmd` shim) — without it, spawn throws `EINVAL`.
//   2. Under a shell, an inline-JSON `--config` arg would be mangled by shell
//      quoting; a file path is a single safe token. The temp file lives next to
//      the lite config (src-tauri/) so its relative paths resolve, and is
//      removed on exit.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const LITE_CONFIG = 'src-tauri/tauri.lite.conf.json';
const TMP_CONFIG = 'src-tauri/.tauri-devtest.gen.conf.json';
const port = Number(process.env.PERSONAS_VITE_PORT) || 1420;

const lite = JSON.parse(readFileSync(LITE_CONFIG, 'utf8'));
const merged = {
  ...lite,
  build: { ...(lite.build ?? {}), devUrl: `http://localhost:${port}` },
};
writeFileSync(TMP_CONFIG, JSON.stringify(merged, null, 2));

const cleanup = () => {
  try {
    rmSync(TMP_CONFIG, { force: true });
  } catch {
    /* best-effort temp cleanup */
  }
};

// `shell: true` so Windows resolves `npx` → `npx.cmd` (Node >=20 throws EINVAL
// spawning a `.cmd` without a shell). Pass a single command STRING (not an args
// array) — that's Node's recommended form under `shell: true` (avoids the
// DEP0190 array+shell warning), and every token here is a static literal with
// no spaces, so there is no injection/quoting hazard. The inline-JSON pitfall
// is sidestepped entirely by passing the config by file path.
const command = `npx tauri dev --config ${TMP_CONFIG} -- --features test-automation`;
const child = spawn(command, { stdio: 'inherit', shell: true });

const forwardSignal = () => {
  try {
    child.kill();
  } catch {
    /* child already gone */
  }
};
process.on('SIGINT', forwardSignal);
process.on('SIGTERM', forwardSignal);

child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
child.on('error', (err) => {
  cleanup();
  console.error('Failed to launch tauri dev:', err);
  process.exit(1);
});
