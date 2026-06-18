#!/usr/bin/env node
// Rust build-cache budget monitor + enforcer for personas-desktop.
//
// THE PROBLEM
// Cargo never garbage-collects `target/`. This crate compiles under five
// profiles (dev, dev-release, release, ci, stable) and more than one target
// triple, each writing a full artifact set, plus an `incremental/` cache that
// only ever grows. Left unattended, `src-tauri/target` reached 324 GB. On top
// of that, every agent worktree under `.claude/worktrees/` keeps its own
// independent `target/` (Cargo defaults the target dir to the worktree root),
// so N worktrees multiply the footprint N times.
//
// WHAT THIS DOES
//   --report        measure the combined footprint, print a breakdown, exit 0
//   --enforce       prune the footprint back under budget, least-destructive
//                   first (see PRUNE ORDER). Asks for confirmation on a TTY.
//   --guard         hook mode: read the cached measurement, print a one-line
//                   warning above 80% of budget, refresh the cache in the
//                   background. Fast and NON-BLOCKING for the common case — it
//                   never fails a build. SELF-HEALING backstop: if the cache is
//                   past the hard ceiling (CACHE_HARD_CEILING_GB, default 150)
//                   AND no compiler is running, it prunes the incremental/
//                   caches synchronously before the build starts. Deps are
//                   never auto-pruned, so the next build stays fast. This is
//                   the piece that stops the unbounded creep an advisory-only
//                   warning never could (it warned all the way to 293 GB once).
//                   "Idle" is judged by the incremental caches' mtime, not by
//                   process enumeration (tasklist crawls under this repo's
//                   thousands of node procs). Opt out with CACHE_AUTO_PRUNE=0.
//   --prune-incremental  delete the main target's incremental/ caches now and
//                   exit (the manual lever behind `npm run clean:incremental`).
//   --json          emit machine-readable JSON (combine with --report)
//   --yes           skip the confirmation prompt in --enforce
//   --measure-only  internal: refresh the cache file silently, then exit
//
// With no flag it defaults to --guard, so run-codegen.mjs can spawn it argless.
//
// BUDGET
// CACHE_BUDGET_GB env var, default 80. The guard warns at 80% of it.
//
// PRUNE ORDER in --enforce (stops as soon as the footprint is under budget):
//   1. worktree target/ dirs, oldest mtime first   (regenerate on next build)
//   2. incremental/ caches in the main target       (only speed up rebuilds)
//   3. `cargo sweep --time 14`, if cargo-sweep is installed (stale artifacts)
//   4. nothing left to safely cut — report that the main target itself is
//      over budget and point at `npm run clean:rust`
//
// Worktree target dirs are only ever deleted by an explicit --enforce run.
// --guard and --report never delete anything.

import { spawn, execFileSync } from "node:child_process";
import {
  existsSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const SELF = fileURLToPath(import.meta.url);
const GIB = 1024 ** 3;
const BUDGET_GB = Number(process.env.CACHE_BUDGET_GB) || 80;
const BUDGET = BUDGET_GB * GIB;
const WARN_RATIO = 0.8;
// How long a cached measurement stays good enough for the --guard warning.
const GUARD_TTL_MS = 12 * 60 * 60 * 1000;

// Self-healing backstop for the --guard hook. Above this ceiling the guard
// auto-prunes the incremental/ caches — the one category that grows without
// bound (Cargo never GCs it) and is always safe to delete (it only accelerates
// rebuilds; deps stay cached so the next build is still fast). The default of
// 150 GB sits comfortably above the deps floor (~90-100 GB for this crate) yet
// well under the 280 GB runaway that prompted this. Tune with
// CACHE_HARD_CEILING_GB; disable the whole behavior with CACHE_AUTO_PRUNE=0.
const HARD_CEILING_GB = Number(process.env.CACHE_HARD_CEILING_GB) || 150;
const HARD_CEILING = HARD_CEILING_GB * GIB;
const AUTO_PRUNE = process.env.CACHE_AUTO_PRUNE !== "0";

const C = {
  reset: "\x1b[0m", yellow: "\x1b[33m", red: "\x1b[31m",
  green: "\x1b[32m", dim: "\x1b[2m",
};

function gb(bytes) {
  return `${(bytes / GIB).toFixed(2)} GB`;
}

// Resolve the MAIN repo root even when invoked from inside a worktree:
// `--git-common-dir` always points at the primary repo's `.git`, so its
// parent is the primary worktree (where `.claude/worktrees/` actually lives).
function mainRepoRoot() {
  try {
    const common = execFileSync(
      "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim();
    if (common) return dirname(common);
  } catch {
    /* fall through */
  }
  return resolve(dirname(SELF), "..");
}

// Recursive byte count. Best-effort: unreadable entries (locked .exe held by a
// running build, races) are skipped rather than aborting the whole measure.
function measureDir(root) {
  if (!existsSync(root)) return 0;
  let bytes = 0;
  let entries;
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    try {
      bytes += statSync(join(e.parentPath ?? e.path, e.name)).size;
    } catch {
      /* skip locked/removed file */
    }
  }
  return bytes;
}

// Every Rust target/ dir under this project: the main one, plus one per
// agent worktree. Each item carries its on-disk mtime so --enforce can drop
// the least-recently-touched worktree caches first.
function listTargets(root) {
  const targets = [];
  const mainTarget = join(root, "src-tauri", "target");
  targets.push({ label: "main", worktree: null, path: mainTarget });

  const wtBase = join(root, ".claude", "worktrees");
  if (existsSync(wtBase)) {
    for (const name of readdirSync(wtBase)) {
      const t = join(wtBase, name, "src-tauri", "target");
      if (existsSync(t)) targets.push({ label: `worktree:${name}`, worktree: name, path: t });
    }
  }

  for (const t of targets) {
    try {
      t.mtime = statSync(t.path).mtimeMs;
    } catch {
      t.mtime = 0;
    }
  }
  return targets;
}

function cachePath(root) {
  // `.claude/*` is gitignored (bar a few allowlisted files), so this scratch
  // file never shows up in `git status`.
  return join(root, ".claude", ".cache-budget.json");
}

function readCache(root) {
  try {
    return JSON.parse(readFileSync(cachePath(root), "utf8"));
  } catch {
    return null;
  }
}

// Full measure of every target dir; persists the result for --guard to reuse.
function measureAll(root) {
  const targets = listTargets(root);
  const items = targets.map((t) => ({
    label: t.label,
    worktree: t.worktree,
    path: t.path,
    mtime: t.mtime,
    bytes: measureDir(t.path),
  }));
  const totalBytes = items.reduce((s, i) => s + i.bytes, 0);
  const snapshot = { measuredAt: Date.now(), budgetGB: BUDGET_GB, totalBytes, items };
  try {
    writeFileSync(cachePath(root), JSON.stringify(snapshot, null, 2));
  } catch {
    /* non-fatal: measurement still usable in-process */
  }
  return snapshot;
}

function findIncrementalDirs(targetRoot, depth = 4) {
  // `incremental/` lives at target/<profile>/incremental and
  // target/<triple>/<profile>/incremental — shallow scan covers both.
  const found = [];
  function walk(dir, d) {
    if (d <= 0 || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.name === "incremental") found.push(full);
      else walk(full, d - 1);
    }
  }
  walk(targetRoot, depth);
  return found;
}

function hasCargoSweep() {
  try {
    execFileSync("cargo", ["sweep", "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function rmDir(path) {
  rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

function statusColor(totalBytes) {
  const ratio = totalBytes / BUDGET;
  if (ratio >= 1) return C.red;
  if (ratio >= WARN_RATIO) return C.yellow;
  return C.green;
}

async function confirm(question) {
  if (process.argv.includes("--yes") || !process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(`${question} [y/N] `, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// ---- modes -----------------------------------------------------------------

function report(root, asJson) {
  const snap = measureAll(root);
  if (asJson) {
    process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
    return;
  }
  const sorted = [...snap.items].sort((a, b) => b.bytes - a.bytes);
  process.stdout.write(`\nRust build cache — budget ${BUDGET_GB} GB\n`);
  process.stdout.write("".padEnd(52, "-") + "\n");
  for (const i of sorted) {
    if (i.bytes === 0) continue;
    process.stdout.write(`  ${i.label.padEnd(38)} ${gb(i.bytes).padStart(11)}\n`);
  }
  const col = statusColor(snap.totalBytes);
  const pct = ((snap.totalBytes / BUDGET) * 100).toFixed(0);
  process.stdout.write("".padEnd(52, "-") + "\n");
  process.stdout.write(`  ${col}TOTAL${C.reset}`.padEnd(48) + `${col}${gb(snap.totalBytes)}${C.reset}\n`);
  process.stdout.write(`  ${col}${pct}% of budget${C.reset}\n\n`);
  if (snap.totalBytes > BUDGET) {
    process.stdout.write(`${C.yellow}Over budget. Reclaim space: npm run clean:cache${C.reset}\n\n`);
  }
}

async function enforce(root) {
  let snap = measureAll(root);
  if (snap.totalBytes <= BUDGET) {
    process.stdout.write(`${C.green}Cache at ${gb(snap.totalBytes)} — under the ${BUDGET_GB} GB budget. Nothing to do.${C.reset}\n`);
    return 0;
  }

  process.stdout.write(`Rust cache is ${gb(snap.totalBytes)} — ${gb(snap.totalBytes - BUDGET)} over the ${BUDGET_GB} GB budget.\n`);
  if (!(await confirm("Prune build caches back under budget?"))) {
    process.stdout.write("Aborted.\n");
    return 1;
  }

  let total = snap.totalBytes;

  // Step 1 — drop worktree target/ dirs, oldest first.
  const worktreeCaches = snap.items
    .filter((i) => i.worktree && i.bytes > 0)
    .sort((a, b) => a.mtime - b.mtime);
  for (const t of worktreeCaches) {
    if (total <= BUDGET) break;
    try {
      rmDir(t.path);
      total -= t.bytes;
      process.stdout.write(`  removed ${t.label}  (-${gb(t.bytes)})\n`);
    } catch (e) {
      process.stderr.write(`  skip ${t.label}: ${e.message}\n`);
    }
  }

  // Step 2 — clear incremental/ caches in the main target.
  if (total > BUDGET) {
    const mainTarget = join(root, "src-tauri", "target");
    for (const inc of findIncrementalDirs(mainTarget)) {
      if (total <= BUDGET) break;
      const b = measureDir(inc);
      try {
        rmDir(inc);
        total -= b;
        process.stdout.write(`  cleared incremental cache ${inc.slice(root.length + 1)}  (-${gb(b)})\n`);
      } catch (e) {
        process.stderr.write(`  skip ${inc}: ${e.message}\n`);
      }
    }
  }

  // Step 3 — time-based prune of stale dependency artifacts.
  if (total > BUDGET && hasCargoSweep()) {
    process.stdout.write("  running `cargo sweep --time 14`...\n");
    try {
      execFileSync("cargo", ["sweep", "--time", "14", join(root, "src-tauri")], { stdio: "inherit" });
      total = measureAll(root).totalBytes;
    } catch (e) {
      process.stderr.write(`  cargo sweep failed: ${e.message}\n`);
    }
  } else if (total > BUDGET && !hasCargoSweep()) {
    process.stdout.write(`${C.dim}  (install cargo-sweep for stale-artifact pruning: cargo install cargo-sweep)${C.reset}\n`);
  }

  // Step 4 — the main target itself is the problem; only a full clean helps.
  if (total > BUDGET) {
    process.stdout.write(
      `\n${C.yellow}Still ${gb(total - BUDGET)} over budget after pruning worktree + incremental caches.\n` +
      `The main src-tauri/target is the bulk of it. For a full reset:\n  npm run clean:rust${C.reset}\n`,
    );
  } else {
    process.stdout.write(`\n${C.green}Done — cache back under budget (${gb(total)}).${C.reset}\n`);
  }
  measureAll(root); // refresh the cached snapshot
  return 0;
}

// Is a build actively writing the incremental caches right now? This is the
// precise signal for "a compile is in flight and a prune would corrupt it" —
// and it deliberately sidesteps process enumeration, which is unreliable in
// this environment: the repo routinely runs thousands of node processes, and
// `tasklist`/`Get-Process` crawl (or outright hang) walking that table. We only
// stat the top-level session dirs inside each incremental/ cache, so the check
// stays O(sessions), never O(files). A fresh mtime resolves to "active" → skip
// the prune, because skipping is always safe and pruning mid-compile is not.
const ACTIVE_BUILD_WINDOW_MS = 90 * 1000;
function incrementalRecentlyActive(root) {
  const mainTarget = join(root, "src-tauri", "target");
  const now = Date.now();
  for (const inc of findIncrementalDirs(mainTarget)) {
    let entries;
    try {
      entries = readdirSync(inc, { withFileTypes: true });
    } catch {
      continue; // unreadable single dir; rmDir handles locks, other dirs still gate
    }
    for (const d of [inc, ...entries.map((e) => join(inc, e.name))]) {
      try {
        if (now - statSync(d).mtimeMs < ACTIVE_BUILD_WINDOW_MS) return true;
      } catch {
        /* removed mid-scan; ignore */
      }
    }
  }
  return false;
}

// Delete every incremental/ cache under the main target. Pure rebuild
// accelerator — safe to remove whenever nothing is compiling. Returns freed bytes.
function pruneIncremental(root) {
  const mainTarget = join(root, "src-tauri", "target");
  let freed = 0;
  for (const inc of findIncrementalDirs(mainTarget)) {
    let bytes = 0;
    try {
      bytes = measureDir(inc);
    } catch {
      /* size unknown; still delete below */
    }
    try {
      rmDir(inc);
      freed += bytes;
    } catch (e) {
      process.stderr.write(`  skip ${inc}: ${e.message}\n`);
    }
  }
  return freed;
}

function guard(root) {
  const cache = readCache(root);

  // Self-healing backstop — see HARD_CEILING comment. Only the incremental
  // category is touched, and only when the toolchain is idle, so a live build
  // is never disrupted and deps are never lost. Runs synchronously (before the
  // build's cargo starts) but ONLY in the rare over-ceiling case, so the common
  // guard path stays instant.
  if (AUTO_PRUNE && cache && cache.totalBytes >= HARD_CEILING && !incrementalRecentlyActive(root)) {
    const freed = pruneIncremental(root);
    if (freed > 0) {
      process.stderr.write(
        `${C.yellow}[cache-budget] Auto-pruned ${gb(freed)} of incremental cache — ` +
        `was ${gb(cache.totalBytes)}, over the ${HARD_CEILING_GB} GB hard ceiling. ` +
        `Deps kept; next build stays fast.${C.reset}\n`,
      );
      // Refresh the snapshot out of band so we don't add a full rescan here.
      try {
        const child = spawn(process.execPath, [SELF, "--measure-only"], {
          detached: true, stdio: "ignore",
        });
        child.unref();
      } catch {
        /* ignore */
      }
      process.exit(0);
    }
  }

  const stale = !cache || Date.now() - cache.measuredAt > GUARD_TTL_MS;

  if (stale) {
    // Refresh the measurement OUT OF BAND so the build is never blocked or
    // failed by a slow disk scan. The next build reads the fresh cache.
    try {
      const child = spawn(process.execPath, [SELF, "--measure-only"], {
        detached: true, stdio: "ignore",
      });
      child.unref();
    } catch {
      /* ignore */
    }
  }

  // Warn from whatever snapshot exists — a slightly stale number is fine for
  // an advisory warning. If there's no cache yet, stay silent this run.
  if (cache && cache.totalBytes >= BUDGET * WARN_RATIO) {
    const col = cache.totalBytes >= BUDGET ? C.red : C.yellow;
    const pct = ((cache.totalBytes / BUDGET) * 100).toFixed(0);
    process.stderr.write(
      `${col}[cache-budget] Rust build cache ~${gb(cache.totalBytes)} / ${BUDGET_GB} GB (${pct}%).${C.reset}\n` +
      `${C.dim}  Inspect: npm run cache:report   Reclaim: npm run clean:cache${C.reset}\n`,
    );
  }
  process.exit(0); // guard is advisory: it must never fail the build
}

// ---- entrypoint ------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const root = mainRepoRoot();

if (args.has("--measure-only")) {
  measureAll(root);
  process.exit(0);
} else if (args.has("--prune-incremental")) {
  const freed = pruneIncremental(root);
  process.stdout.write(`${C.green}Pruned ${gb(freed)} of incremental cache.${C.reset}\n`);
  measureAll(root);
  process.exit(0);
} else if (args.has("--enforce")) {
  enforce(root).then((code) => process.exit(code)).catch((e) => {
    process.stderr.write(`cache-budget: ${e.message}\n`);
    process.exit(1);
  });
} else if (args.has("--report")) {
  report(root, args.has("--json"));
  process.exit(0);
} else {
  // default: --guard
  guard(root);
}
