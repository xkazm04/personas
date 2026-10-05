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
// `--config` by PATH (not inline JSON): a file path is a single safe token
// whatever launches tauri (this script used to spawn `npx` under a shell, where
// inline JSON was mangled by quoting). The temp file lives next to the lite
// config (src-tauri/) so its relative paths resolve, and is removed on exit.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

import { runWrapped } from '../devlog/run.mjs';
import { ensureMcpSidecar } from './ensure-mcp-sidecar.mjs';

const LITE_CONFIG = 'src-tauri/tauri.lite.conf.json';
const TMP_CONFIG = 'src-tauri/.tauri-devtest.gen.conf.json';
const port = Number(process.env.PERSONAS_VITE_PORT) || 1420;

const lite = JSON.parse(readFileSync(LITE_CONFIG, 'utf8'));
const merged = {
  ...lite,
  build: { ...(lite.build ?? {}), devUrl: `http://localhost:${port}` },
};
// The personas MCP sidecar is a separate cargo [[bin]] that `tauri dev` never
// builds, so without this a fresh worktree (the Grand Simulation's sim-app, which
// launches through this script) runs every persona with no mcp__personas__* tools.
// Synchronous and before the app's cargo: one cargo at a time. Never fatal.
ensureMcpSidecar('desktop,test-automation');

writeFileSync(TMP_CONFIG, JSON.stringify(merged, null, 2));

const cleanup = () => {
  try {
    rmSync(TMP_CONFIG, { force: true });
  } catch {
    /* best-effort temp cleanup */
  }
};

// Launched through the devlog wrapper (scripts/devlog/run.mjs), like every
// other tauri:dev* script: output passes through unchanged, the toolchain's
// diagnostics land in toolchain.YYYY-MM-DD.jsonl, Ctrl+C reaches the tree and
// the exit code propagates. The wrapper spawns the tauri CLI with node directly
// (no shell, so no `.cmd` EINVAL and no quoting), and the config still goes by
// file path.
runWrapped({
  args: ['--config', TMP_CONFIG, '--', '--features', 'test-automation'],
  onExit: cleanup,
})
  .then((code) => process.exit(code))
  .catch((err) => {
    cleanup();
    console.error('Failed to launch tauri dev:', err);
    process.exit(1);
  });
