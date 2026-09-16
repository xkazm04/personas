#!/usr/bin/env node
// Sweep the system temp directory of what agents, test suites and dev tools
// left behind.
//
//   npm run clean:temp                  # dry run: what would go, and how much
//   npm run clean:temp -- --delete      # act
//   npm run clean:temp -- --hours 48    # a longer grace window (default 24)
//
// WHY THIS EXISTS
// ---------------
// Windows never evicts %TEMP% on its own. Measured 2026-09-14: 53.8 GB across
// 69,603 top-level entries, almost all written July to September. The largest
// shares were copies of personas.db (11.8 GB, ~203 MB each, taken to read the
// database while the app held it), cargo target dirs pointed at %TEMP% by
// unattended workers (9 GB), per-test SQLite files from sibling repos (5.5 GB),
// and Claude Code's own per-session scratch under %TEMP%\claude (5.3 GB).
//
// WHAT IT WILL NOT DELETE
// -----------------------
// - Anything whose NEWEST file (walked deep, not the directory's own mtime) was
//   written inside the grace window. A cargo target's top-level mtime can be
//   days old while a build is writing into it right now.
// - Any path a running process names on its command line (headless workers,
//   gate runs and Python jobs routinely run out of %TEMP%).
// - Tool caches that rebuild themselves or belong to an installer in progress.
// - Under %TEMP%\claude it works one level down, per session directory, so a
//   live session's scratchpad is judged by its own age, not its project's.
// An entry it cannot read is treated as fresh and left alone.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const DELETE = args.includes('--delete');
const hoursArg = args.indexOf('--hours');
const GRACE_H = hoursArg >= 0 ? Number(args[hoursArg + 1]) : 24;
if (!Number.isFinite(GRACE_H) || GRACE_H < 1) {
  console.error('temp-gc: --hours must be a number >= 1');
  process.exit(2);
}
const GRACE_MS = GRACE_H * 3600e3;
const now = Date.now();

const TEMP = process.env.TEMP || process.env.TMP || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Temp'));
if (!TEMP || !fs.existsSync(TEMP)) {
  console.error(`temp-gc: no temp directory found (${TEMP ?? 'TEMP unset'})`);
  process.exit(2);
}

// Never swept as a whole:
// - tool caches, rebuilt on demand or owned by an installer/editor while it runs;
// - `personas-workspace`: the runner's STABLE per-persona exec dir
//   (src-tauri/src/engine/runner/mod.rs), kept across runs on purpose. A
//   persona idle for a day is not garbage. It is not left to grow either:
//   the engine sweeps each persona's workspace itself, at most once a day,
//   removing top-level entries nothing has touched for three days while
//   keeping the CLI's own state (`.claude`, `CLAUDE.md`, `.personas`) —
//   see `src-tauri/src/engine/runner/workspace_gc.rs`. This script must stay
//   out of that directory: it cannot tell a live run's cwd from a leftover;
// - `claude`: handled below, one session at a time.
const PROTECTED = new Set([
  'DockerDesktopUpdates',
  'node-compile-cache',
  'vscode-insider-user-x64',
  'personas-workspace',
  'claude',
]);

function runningCommandLines() {
  try {
    const cmd = process.platform === 'win32'
      ? 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"'
      : 'ps -eo args=';
    return execSync(cmd, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString().toLowerCase();
  } catch {
    return null;
  }
}

const procText = runningCommandLines();
if (procText === null && DELETE) {
  console.error('temp-gc: could not list running processes; refusing to delete without that check');
  process.exit(2);
}
const namedByProcess = (p) => procText !== null && procText.includes(p.toLowerCase());

/** [newest mtime anywhere under p, total bytes]. Unreadable counts as fresh. */
function measure(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return [now, 0]; }
  if (st.isSymbolicLink() || !st.isDirectory()) return [st.mtimeMs, st.isSymbolicLink() ? 0 : st.size];
  let entries;
  try { entries = fs.readdirSync(p); } catch { return [now, 0]; }
  let newest = st.mtimeMs;
  let bytes = 0;
  for (const e of entries) {
    const [m, b] = measure(path.join(p, e));
    if (m > newest) newest = m;
    bytes += b;
  }
  return [newest, bytes];
}

const plan = [];
const kept = { fresh: 0, inUse: 0 };
function consider(full) {
  const [newest, bytes] = measure(full);
  if (now - newest < GRACE_MS) { kept.fresh += bytes; return; }
  if (namedByProcess(full)) { kept.inUse += bytes; return; }
  plan.push({ full, bytes });
}

// A real temp directory is never empty. An empty listing means the path or the
// listing is wrong, and "nothing to sweep" would then be a report about nothing.
const topLevel = fs.readdirSync(TEMP);
if (topLevel.length === 0) {
  console.error(`temp-gc: ${TEMP} listed no entries at all; refusing to report on a directory it did not see`);
  process.exit(2);
}
for (const name of topLevel) {
  if (PROTECTED.has(name)) continue;
  consider(path.join(TEMP, name));
}

// %TEMP%\claude\<project>\<session>: judge each session on its own.
const claudeRoot = path.join(TEMP, 'claude');
if (fs.existsSync(claudeRoot)) {
  for (const name of fs.readdirSync(claudeRoot)) {
    const full = path.join(claudeRoot, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isDirectory() && name.startsWith('C--')) {
      for (const session of fs.readdirSync(full)) consider(path.join(full, session));
    } else {
      consider(full);
    }
  }
}

const gb = (b) => (b / 1e9).toFixed(2);
const total = plan.reduce((a, x) => a + x.bytes, 0);
console.log(`temp-gc ${DELETE ? 'DELETE' : 'dry run'} in ${TEMP}, grace ${GRACE_H}h`);
console.log(`  eligible: ${plan.length} entries, ${gb(total)} GB`);
console.log(`  kept:     ${gb(kept.fresh)} GB written inside the grace window, ${gb(kept.inUse)} GB named by a running process`);
if (!DELETE) {
  for (const x of [...plan].sort((a, b) => b.bytes - a.bytes).slice(0, 15)) {
    console.log(`  ${(x.bytes / 1e6).toFixed(0).padStart(7)} MB  ${x.full}`);
  }
  console.log('  (dry run; pass --delete to act)');
  process.exit(0);
}

let removed = 0;
let failed = 0;
let freed = 0;
for (const x of plan) {
  try {
    fs.rmSync(x.full, { recursive: true, force: true, maxRetries: 2 });
    removed++;
    freed += x.bytes;
  } catch {
    failed++; // locked by a process that did not name it; the next run retries
  }
}
console.log(`  removed ${removed}, left ${failed} locked, freed ~${gb(freed)} GB`);
