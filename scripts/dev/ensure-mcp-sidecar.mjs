#!/usr/bin/env node
// Build the `personas-mcp` sidecar into the cargo target a dev launch runs from.
//
//   node scripts/dev/ensure-mcp-sidecar.mjs --features desktop
//   node scripts/dev/ensure-mcp-sidecar.mjs --features desktop,test-automation
//
// Why this exists: the runner installs the personas MCP sidecar for every
// execution, and `find_mcp_binary` (src-tauri/engine/src/cli_mcp_config.rs)
// looks for `personas-mcp[.exe]` only next to the running app binary. That
// binary is a separate `[[bin]]` in src-tauri/Cargo.toml, and `tauri dev` builds
// only `personas-desktop`, so a fresh checkout or worktree (the sim-app
// worktree, measured 2026-09-15) never has one and every run silently loses all
// `mcp__personas__*` tools, while the main checkout kept an exe a week older
// than the code it serves.
//
// Policy:
//   - builds when the exe is missing, or older than the newest source under
//     src-tauri/src/mcp_server/ or src-tauri/src/mcp_bin.rs; otherwise a no-op,
//     because a build here can re-run the app crate's build script (tauri-build
//     reruns on TAURI_CONFIG, which `tauri dev` sets and this build does not) and
//     that costs one incremental app_lib compile on the next launch;
//   - uses the SAME --features as the app launch it precedes, so dependencies
//     compiled for one are reused by the other. DO NOT narrow this to "what the
//     sidecar needs": a different feature set forks cargo's feature resolution
//     and buys a second full compile of the dependency graph instead of reusing
//     the app's artifacts. The lite/full choice moves both at once, from
//     package.json's pretauri:dev* hooks;
//   - respects CARGO_TARGET_DIR (a worktree sharing the main target);
//   - runs synchronously, before the app's cargo, since two cargo processes at
//     once on Windows is the memory failure this repo keeps measuring, and goes
//     through scripts/build/cargo-run.mjs so the throttle (below-normal
//     priority, cores-2 jobs) and the one-cargo-at-a-time queue apply here too;
//   - never blocks a launch: a failed build (for instance the exe is held open
//     by a live run) prints one warning and exits 0.
//
// Env: PERSONAS_MCP_SIDECAR=skip to skip, PERSONAS_MCP_SIDECAR=force to rebuild.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCargo } from '../build/cargo-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const log = (m) => console.log(`[mcp-sidecar] ${m}`);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

/** Newest mtime (ms) of any file under `p`, or 0 when `p` does not exist. */
function newestMtime(p) {
  let st;
  try { st = fs.statSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const entry of fs.readdirSync(p)) newest = Math.max(newest, newestMtime(path.join(p, entry)));
  return newest;
}

export function sidecarPath() {
  const target = process.env.CARGO_TARGET_DIR
    ? path.resolve(ROOT, process.env.CARGO_TARGET_DIR)
    : path.join(ROOT, 'src-tauri', 'target');
  return path.join(target, 'debug', `personas-mcp${process.platform === 'win32' ? '.exe' : ''}`);
}

export function ensureMcpSidecar(features) {
  const mode = (process.env.PERSONAS_MCP_SIDECAR || '').toLowerCase();
  if (mode === 'skip') { log('PERSONAS_MCP_SIDECAR=skip; not building'); return true; }

  const exe = sidecarPath();
  const exeMtime = newestMtime(exe);
  const srcMtime = Math.max(
    newestMtime(path.join(ROOT, 'src-tauri', 'src', 'mcp_server')),
    newestMtime(path.join(ROOT, 'src-tauri', 'src', 'mcp_bin.rs')),
  );
  if (mode !== 'force' && exeMtime > 0 && exeMtime >= srcMtime) {
    log(`${path.relative(ROOT, exe)} is current`);
    return true;
  }
  log(`${exeMtime === 0 ? 'missing' : 'stale'}: building ${path.relative(ROOT, exe)} (features: ${features || 'none'})`);
  // `features` is still refused unless it is a plain list. runCargo spawns under
  // a shell on Windows (Node >=20 needs one to resolve the cargo shim), so this
  // string reaches a command line and the validation is a security boundary, not
  // tidiness. The manifest path is kept RELATIVE for the same reason: `cwd` is
  // passed as an option and is never quoted, so a repo root containing a space
  // cannot break the argv the shell reassembles.
  if (features && !/^[A-Za-z0-9_,-]+$/.test(features)) {
    log(`refusing features "${features}": expected a comma-separated list of names`);
    return false;
  }
  const status = runCargo({
    args: [
      'build',
      '--manifest-path', 'src-tauri/Cargo.toml',
      '--bin', 'personas-mcp',
      ...(features ? ['--features', features] : []),
    ],
    cwd: ROOT,
    label: 'sidecar',
  });
  if (status !== 0) {
    log(`WARNING: cargo build of personas-mcp failed (exit ${status}); runs in this launch will have no personas MCP tools`);
    return false;
  }
  log('built');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureMcpSidecar(arg('features', 'desktop'));
}
