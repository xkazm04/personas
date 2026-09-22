#!/usr/bin/env node
// Rust build-cache budget — measure AND enforce — for personas-desktop.
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
// WHY v2 (2026-09-18) — A WARNING IS NOT A BUDGET
// v1 had an 80 GB "budget" that nothing enforced. The only automatic lever was
// the guard's self-heal, and it fired at a 150 GB hard ceiling and pruned only
// `incremental/`. Between 80 and 150 sat a dead band where the guard printed a
// line and deleted nothing — it "warned all the way to 293 GB once", and one
// real ENOSPC truncated a source file. Measured 2026-09-18: target/debug at
// 88.3 GiB = 110% of budget, and not one byte had ever been evicted
// automatically. deps/ held 41 GB with 1,766 hash-sets of personas_db and 1,659
// of personas_engine (cargo never reaps a superseded hash), incremental/ 46 GB
// across 116 session dirs, build/ 6.5 GB with no reaper at any tier. The guard
// decided all this from a 12 h-old snapshot reading 99% while reality was 110%,
// and its target list could not see four alternate target dirs or the cargo
// targets unattended workers leave in %TEMP% (see scripts/hygiene/targets.mjs).
//
// v2: the budget is 60 GiB and it is ENFORCED AT THE BUDGET — by the
// predev/prebuild guard and by a daily scheduled task
// (scripts/hygiene/run-daily.mjs). There is no dead band.
//
// MODES
//   --report        measure every discovered target, print label/kind/bytes. Never deletes.
//   --enforce       prune back under budget now (trigger "manual"). Asks on a TTY.
//                   Exits NON-ZERO if anything could not be measured or the
//                   footprint is still over budget afterwards.
//   --guard         hook mode (the default with no flag; run-codegen spawns it
//                   argless). Reads the snapshot only — NO directory walk. If the
//                   snapshot is fresh, complete and under 80% of budget it exits
//                   silently. Otherwise it hands a fresh measurement + enforcement
//                   to a DETACHED background process, prints one line saying so,
//                   and exits 0. It never fails or blocks a build, and it never
//                   prints "under budget" about something it did not measure.
//                   From a WORKTREE's copy of this script it only ever advises —
//                   see guardMayEnforce() for the incident behind that.
//   --guard-background  internal: the detached half of --guard.
//   --prune-incremental  delete the main target's incremental/ caches now
//                   (the lever behind `npm run clean:incremental`).
//   --json          machine-readable output (with --report)
//   --yes           skip the confirmation prompt in --enforce
//   --dry-run       with --enforce: print what would be evicted, delete nothing
//   --measure-only  internal: refresh the snapshot silently, then exit
//
// BUDGET
// CACHE_BUDGET_GB, default 60 (GiB), across ALL discovered targets combined.
// CACHE_HARD_CEILING_GB (default 150) survives only as a second-line ALARM: past
// it the guard's line turns red and says enforcement is failing to hold the
// budget. It no longer gates anything. CACHE_AUTO_PRUNE=0 makes the guard
// advisory-only (it then says so, with the number).
//
// EVICTION ORDER — by rebuild-seconds-saved-per-MB, stale variant state first,
// hot third-party dependency artifacts LAST. Stops the moment the footprint is
// under budget. Age-first inside every stage.
//   a. superseded workspace-crate hash-sets in <profile>/deps/ (+ their
//      .fingerprint dirs). Workspace crates are recompiled on every edit and
//      each compile leaves a new `<name>-<hash>` set that nothing ever removes;
//      only the newest is ever reused. Crate names are DERIVED from
//      src-tauri/Cargo.toml — a third-party crate can never match. Keeps the
//      newest KEEP_HASH_SETS (3) sets per crate per shape (check / lib / bin — a `cargo check`
//      set and a `cargo build` set of the same crate are both current).
//   b. incremental/ session dirs, oldest first.
//      (a) and (b) run at >3 days, then >1 day, then (a) at any age.
//   c. `cargo sweep --time 7` when cargo-sweep is installed — the first stage
//      that can touch third-party deps, and only ones unused for a week.
//   d. build/ out-dirs whose `<name>-<hash>` has no .fingerprint entry (orphans).
//   e. manual --enforce only: whole worktree target dirs, oldest first.
//   f. nothing safe is left: say that a stale profile dir / `npm run clean:rust`
//      is needed. `cargo clean` is never run automatically.
// Recovery from any eviction is one warm rebuild.
//
// THE REAPER NEVER RACES A BUILD
// Before every stage and every deletion batch it checks the profile dir is idle:
//   1. lock probe — cargo holds an exclusive byte-range lock on
//      `<profile>/.cargo-lock` (and .cargo-build-lock / .cargo-artifact-lock) for
//      the whole build. Those files always EXIST, and a locked file still OPENS
//      for write on Windows, so neither is a signal. Measured 2026-09-18: a
//      1-byte READ at offset 0 returns EBUSY while the lock is held and 0 bytes
//      when it is free, and it mutates nothing. That read is the probe.
//      (POSIX flock is invisible to it; there only check 2 applies.)
//   2. incremental mtime — any incremental session dir touched in the last 90 s.
//      Deliberately NOT process enumeration: tasklist/Get-Process crawl or hang
//      under this repo's thousands of node processes.
// A probe that errors in any way it does not understand counts as LIVE.
// "Could not check" is never "clean".

import { spawn, execFileSync } from "node:child_process";
import {
  existsSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync,
  openSync, readSync, closeSync, unlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { discoverTargetsDetailed, findProfileDirs } from "./hygiene/targets.mjs";
import { recordEviction, formatBytes } from "./hygiene/log.mjs";

const SELF = fileURLToPath(import.meta.url);
export const GIB = 1024 ** 3;
const DAY_MS = 86_400_000;
export const DEFAULT_BUDGET_GB = 60;
const BUDGET_GB = Number(process.env.CACHE_BUDGET_GB) || DEFAULT_BUDGET_GB;
const BUDGET = BUDGET_GB * GIB;
const WARN_RATIO = 0.8;
// How long a snapshot may be trusted for the guard's "clearly under budget,
// exit fast" decision. Anything at or above 80% is re-measured regardless, so
// this only bounds how long a sub-80% reading is believed.
const GUARD_TTL_MS = 6 * 60 * 60 * 1000;
const HARD_CEILING_GB = Number(process.env.CACHE_HARD_CEILING_GB) || 150;
const HARD_CEILING = HARD_CEILING_GB * GIB;
const AUTO_PRUNE = process.env.CACHE_AUTO_PRUNE !== "0";
// The detached guard half re-tries while a build is live, for at most this long.
const GUARD_WAIT_MIN = Number(process.env.CACHE_GUARD_WAIT_MIN || 20);
export const ACTIVE_BUILD_WINDOW_MS = 90 * 1000;
// 3, not 2: the repo has three live lanes (desktop, desktop-full, +test-automation), each
// with its own VALID hash per crate, and cargo never bumps an artifact's mtime on reuse -
// so "newest by mtime" only approximates "current". Director review, 2026-09-18.
export const KEEP_HASH_SETS = 3;

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
// Asked from this script's own directory, not the process cwd, so the scheduled
// task resolves the same root whatever directory it was started in.
// CACHE_BUDGET_ROOT overrides — that is how tests and timing runs point every
// mode at a fixture instead of the real 95 GB tree.
export function mainRepoRoot() {
  if (process.env.CACHE_BUDGET_ROOT) return resolve(process.env.CACHE_BUDGET_ROOT);
  // Fast paths first — no child process. Measured 2026-09-18 on a loaded host:
  // `git rev-parse` cost 500–900 ms, the rest of the under-budget guard ~65 ms.
  // The guard runs on every predev/prebuild, so git is the fallback, not the rule.
  const checkout = resolve(dirname(SELF), "..");
  const wt = /^(.*)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/.exec(checkout);
  if (wt && existsSync(join(wt[1], ".git"))) return wt[1];
  try {
    if (statSync(join(checkout, ".git")).isDirectory()) return checkout; // primary checkout
  } catch {
    /* no .git here: ask git */
  }
  try {
    const common = execFileSync(
      "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", cwd: dirname(SELF), stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (common) return dirname(common);
  } catch {
    /* fall through */
  }
  return resolve(dirname(SELF), "..");
}

// ---- measurement -----------------------------------------------------------

// Recursive byte count that can say "I could not look". A missing dir is 0 bytes
// and OK (nothing there is a fact). A dir that exists but cannot be listed is
// NOT 0 bytes — v1 returned 0 for it, which let an unreadable 95 GB tree read as
// an empty one. Individual files that vanish or are locked mid-walk (a running
// build's .exe) are skipped and counted; they do not fail the measure.
export function measureDirStrict(root) {
  if (!existsSync(root)) return { bytes: 0, ok: true, skipped: 0 };
  let entries;
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch (e) {
    return { bytes: 0, ok: false, skipped: 0, error: `${e.code ?? "ERR"}: ${e.message}` };
  }
  let bytes = 0;
  let skipped = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    try {
      bytes += statSync(join(e.parentPath ?? e.path, e.name)).size;
    } catch {
      skipped++;
    }
  }
  return { bytes, ok: true, skipped };
}

function cachePath(root) {
  // `.claude/*` is gitignored (bar a few allowlisted files), so this scratch
  // file never shows up in `git status`.
  return join(root, ".claude", ".cache-budget.json");
}

export function readCache(root) {
  try {
    return JSON.parse(readFileSync(cachePath(root), "utf8"));
  } catch {
    return null;
  }
}

function writeCache(root, snapshot) {
  try {
    writeFileSync(cachePath(root), JSON.stringify(snapshot, null, 2));
  } catch {
    /* non-fatal: measurement still usable in-process */
  }
}

// Full measure of every discovered target; persists the result for --guard.
export function measureAll(root, opts = {}) {
  const measure = opts.measure ?? measureDirStrict;
  const { targets, warnings } = opts.targets
    ? { targets: opts.targets, warnings: [] }
    : discoverTargetsDetailed({ root, tmpdir: opts.tmpdir ?? (process.env.CACHE_BUDGET_TMPDIR || undefined) });
  const items = targets.map((t) => {
    const m = measure(t.path);
    return {
      label: t.label, kind: t.kind, worktree: t.worktree ?? null, path: t.path,
      mtime: t.mtime ?? 0, bytes: m.bytes, ok: m.ok, error: m.error ?? null,
    };
  });
  const totalBytes = items.reduce((s, i) => s + i.bytes, 0);
  const unmeasured = items.filter((i) => !i.ok).map((i) => ({ label: i.label, error: i.error }));
  const prev = readCache(root);
  const snapshot = {
    measuredAt: opts.now ?? Date.now(), budgetGB: opts.budgetGB ?? BUDGET_GB,
    totalBytes, items, unmeasured, discoveryWarnings: warnings,
    lastEnforce: prev?.lastEnforce ?? null,
  };
  if (opts.persist !== false) writeCache(root, snapshot);
  return snapshot;
}

// ---- liveness --------------------------------------------------------------

const LOCK_FILES = [".cargo-lock", ".cargo-build-lock", ".cargo-artifact-lock"];

/** null when the lock is free (or absent); otherwise the reason it counts as held. */
export function lockHeldReason(profileDir) {
  for (const name of LOCK_FILES) {
    const p = join(profileDir, name);
    let fd;
    try {
      fd = openSync(p, "r");
    } catch (e) {
      if (e.code === "ENOENT") continue;
      return `${name} could not be opened (${e.code}) — treated as a live build`;
    }
    try {
      readSync(fd, Buffer.alloc(1), 0, 1, 0);
    } catch (e) {
      return `${name} is locked by a running cargo (${e.code})`;
    } finally {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
  return null;
}

function incrementalActiveReason(profileDir, now) {
  const inc = join(profileDir, "incremental");
  let entries;
  try {
    entries = readdirSync(inc, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return null;
    return `incremental/ could not be listed (${e.code}) — treated as a live build`;
  }
  // Session dirs only — NOT incremental/ itself. v1 also stat'ed the parent, but
  // removing a session dir bumps the parent's mtime, so the reaper's own first
  // deletion made the target read as "a build is in flight" and it refused
  // itself for the next 90 s (caught by this script's fixture test, 2026-09-18).
  // Nothing is lost: a build that starts a session creates or touches a session
  // dir, which is checked. A long single rustc that writes only deep inside its
  // working dir moves neither mtime — that case is what the lock probe is for.
  for (const d of entries.filter((e) => e.isDirectory()).map((e) => join(inc, e.name))) {
    try {
      const age = now - statSync(d).mtimeMs;
      if (age < ACTIVE_BUILD_WINDOW_MS) {
        return `incremental cache written ${Math.max(0, Math.round(age / 1000))} s ago (< ${ACTIVE_BUILD_WINDOW_MS / 1000} s) — a build is in flight`;
      }
    } catch {
      /* removed mid-scan; ignore */
    }
  }
  return null;
}

/** null when idle, else why this profile dir must not be touched right now. */
export function profileLiveReason(profileDir, now = Date.now()) {
  return lockHeldReason(profileDir) ?? incrementalActiveReason(profileDir, now);
}

/** null when every profile dir of the target is idle. */
export function targetLiveReason(targetPath, now = Date.now()) {
  const top = lockHeldReason(targetPath); // a build-dir keeps its lock at the root
  if (top) return top;
  for (const p of findProfileDirs(targetPath)) {
    const r = profileLiveReason(p, now);
    if (r) return `${basename(p)}: ${r}`;
  }
  return null;
}

// ---- workspace crate names (derived, never hardcoded) ------------------------

function parseManifestNames(manifestPath) {
  const text = readFileSync(manifestPath, "utf8");
  let section = "";
  let pkg = null;
  let lib = null;
  const bins = [];
  let members = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^\s*(\[\[?)\s*([\w.-]+)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (h) { section = (h[1] === "[[" ? "[[" : "") + h[2]; continue; }
    const name = /^\s*name\s*=\s*"([^"]+)"/.exec(line);
    if (name) {
      if (section === "package") pkg = name[1];
      else if (section === "lib") lib = name[1];
      else if (section === "[[bin") bins.push(name[1]);
    }
    if (section === "workspace" && /^\s*members\s*=/.test(line)) {
      let buf = line;
      while (!buf.includes("]") && i + 1 < lines.length) buf += lines[++i];
      members = [...buf.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    }
  }
  return { pkg, lib, bins, members };
}

/**
 * The crates that belong to THIS workspace, as `{ package, stems }`:
 *   package — the `.fingerprint/<package>-<hash>` prefix (dashes kept)
 *   stems   — every `deps/<stem>-<hash>.*` prefix the package produces: its lib
 *             name and its bin names, dashes -> underscores (rustc crate names)
 * Anything not in this list is third-party and is invisible to the reaper.
 * Throws when the manifest cannot be read: no names means no reaping, and the
 * caller says so rather than guessing.
 */
export function workspaceCrates(srcTauriDir) {
  const rootManifest = parseManifestNames(join(srcTauriDir, "Cargo.toml"));
  const members = rootManifest.members ?? ["."];
  const crates = [];
  for (const m of members) {
    if (m.includes("*")) continue; // globs are not used here; do not guess
    const dir = resolve(srcTauriDir, m);
    const man = m === "." ? rootManifest : parseManifestNames(join(dir, "Cargo.toml"));
    if (!man.pkg) continue;
    const us = (s) => s.replace(/-/g, "_");
    const stems = new Set([us(man.lib ?? man.pkg)]);
    for (const b of man.bins) stems.add(us(b));
    if (existsSync(join(dir, "src", "main.rs"))) stems.add(us(man.pkg));
    crates.push({ package: man.pkg, stems: [...stems] });
  }
  return crates;
}

// ---- reapers -----------------------------------------------------------------
// Each returns { bytesFreed, count, detail, refused? } and deletes nothing when
// `dryRun`. "Age" is always judged against `now` so tests can pin time.

function rmPath(p) {
  rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

function sizeOfTree(p) {
  return measureDirStrict(p).bytes;
}

const HASH = "[0-9a-f]{16}";

function shapeOf(exts) {
  if (exts.has("exe") || exts.has("")) return "bin";
  if (exts.has("rlib") || exts.has("dll") || exts.has("so") || exts.has("dylib") || exts.has("lib")) return "lib";
  return "check";
}

/**
 * Group `deps/` files of workspace crates into hash-sets.
 * @returns Map<stem, Array<{hash, files:[{path,size}], bytes, mtime, shape}>>
 */
export function collectHashSets(depsDir, stems) {
  const stemSet = new Set(stems);
  const re = new RegExp(`^(?:lib)?([A-Za-z0-9_]+)-(${HASH})(?:\\.(.+))?$`);
  const byStem = new Map();
  for (const name of readdirSync(depsDir)) {
    const m = re.exec(name);
    if (!m || !stemSet.has(m[1])) continue;
    let st;
    try {
      st = statSync(join(depsDir, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const sets = byStem.get(m[1]) ?? new Map();
    byStem.set(m[1], sets);
    const set = sets.get(m[2]) ?? { hash: m[2], files: [], bytes: 0, mtime: 0, exts: new Set() };
    sets.set(m[2], set);
    set.files.push({ path: join(depsDir, name), size: st.size });
    set.bytes += st.size;
    set.mtime = Math.max(set.mtime, st.mtimeMs);
    set.exts.add((m[3] ?? "").split(".").pop());
  }
  const out = new Map();
  for (const [stem, sets] of byStem) {
    out.set(stem, [...sets.values()].map((s) => ({ ...s, shape: shapeOf(s.exts) })));
  }
  return out;
}

/**
 * (a) Superseded workspace-crate hash-sets. Keeps the newest `keep` sets per
 * crate per shape; of the rest, deletes those older than `minAgeMs` (and never
 * one inside the 90 s active window). Third-party crates never match `crates`.
 */
export function reapSupersededDeps(profileDir, crates, { minAgeMs = 0, keep = KEEP_HASH_SETS, now = Date.now(), dryRun = false, maxBytes = Infinity } = {}) {
  const depsDir = join(profileDir, "deps");
  if (!existsSync(depsDir)) return { bytesFreed: 0, count: 0 };
  const stemToPackage = new Map();
  for (const c of crates) for (const s of c.stems) stemToPackage.set(s, c.package);
  const byStem = collectHashSets(depsDir, [...stemToPackage.keys()]);
  const fpDir = join(profileDir, ".fingerprint");

  const victims = [];
  for (const [stem, sets] of byStem) {
    const byShape = new Map();
    for (const s of sets) byShape.set(s.shape, [...(byShape.get(s.shape) ?? []), s]);
    for (const group of byShape.values()) {
      group.sort((a, b) => b.mtime - a.mtime);
      for (const s of group.slice(keep)) {
        const age = now - s.mtime;
        if (age < Math.max(minAgeMs, ACTIVE_BUILD_WINDOW_MS)) continue;
        victims.push({ stem, ...s });
      }
    }
  }
  victims.sort((a, b) => a.mtime - b.mtime); // age-first

  let bytesFreed = 0;
  let count = 0;
  const cratesHit = new Set();
  let i = 0;
  for (const v of victims) {
    if (bytesFreed >= maxBytes) break;
    // Re-probe every 25 sets: cheap, and it bounds how far a prune can run into
    // a build that started after the stage began.
    if (!dryRun && i++ % 25 === 0) {
      const live = profileLiveReason(profileDir, Date.now());
      if (live) return { bytesFreed, count, crates: cratesHit.size, refused: live };
    }
    let freed = 0;
    for (const f of v.files) {
      if (dryRun) { freed += f.size; continue; }
      try {
        rmSync(f.path, { force: true });
        freed += f.size;
      } catch {
        /* locked by something that did not take the cargo lock; next run retries */
      }
    }
    const fp = join(fpDir, `${stemToPackage.get(v.stem)}-${v.hash}`);
    if (existsSync(fp)) {
      const b = sizeOfTree(fp);
      if (dryRun) freed += b;
      else {
        try { rmPath(fp); freed += b; } catch { /* next run */ }
      }
    }
    bytesFreed += freed;
    count++;
    cratesHit.add(v.stem);
  }
  return { bytesFreed, count, crates: cratesHit.size };
}

/** (b) incremental/ session dirs older than `minAgeMs`, oldest first. */
export function reapIncremental(profileDir, { minAgeMs, now = Date.now(), dryRun = false, maxBytes = Infinity } = {}) {
  const inc = join(profileDir, "incremental");
  if (!existsSync(inc)) return { bytesFreed: 0, count: 0 };
  const sessions = [];
  for (const e of readdirSync(inc, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const full = join(inc, e.name);
    // A session dir's own mtime moves only when an `s-…` child is added; the
    // newest child is the honest "last written".
    let newest = 0;
    try {
      newest = statSync(full).mtimeMs;
      for (const c of readdirSync(full)) {
        try { newest = Math.max(newest, statSync(join(full, c)).mtimeMs); } catch { /* raced */ }
      }
    } catch {
      continue; // cannot judge its age -> leave it
    }
    sessions.push({ full, newest });
  }
  sessions.sort((a, b) => a.newest - b.newest);
  let bytesFreed = 0;
  let count = 0;
  for (const s of sessions) {
    if (bytesFreed >= maxBytes) break;
    if (now - s.newest < Math.max(minAgeMs, ACTIVE_BUILD_WINDOW_MS)) continue;
    if (!dryRun) {
      const live = profileLiveReason(profileDir, Date.now());
      if (live) return { bytesFreed, count, refused: live };
    }
    const b = sizeOfTree(s.full);
    if (!dryRun) {
      try { rmPath(s.full); } catch { continue; }
    }
    bytesFreed += b;
    count++;
  }
  return { bytesFreed, count };
}

/** (d) build/ out-dirs with no matching .fingerprint entry. */
export function reapBuildOrphans(profileDir, { now = Date.now(), dryRun = false, maxBytes = Infinity } = {}) {
  const buildDir = join(profileDir, "build");
  const fpDir = join(profileDir, ".fingerprint");
  if (!existsSync(buildDir)) return { bytesFreed: 0, count: 0 };
  let fps;
  try {
    fps = new Set(readdirSync(fpDir));
  } catch (e) {
    // No fingerprint listing means EVERY build dir would look orphaned.
    return { bytesFreed: 0, count: 0, skipped: `.fingerprint could not be listed (${e.code}) — orphans NOT judged` };
  }
  const re = new RegExp(`^.+-${HASH}$`);
  let bytesFreed = 0;
  let count = 0;
  for (const e of readdirSync(buildDir, { withFileTypes: true })) {
    if (bytesFreed >= maxBytes) break;
    if (!e.isDirectory() || !re.test(e.name) || fps.has(e.name)) continue;
    const full = join(buildDir, e.name);
    try {
      if (now - statSync(full).mtimeMs < ACTIVE_BUILD_WINDOW_MS) continue;
    } catch {
      continue;
    }
    if (!dryRun) {
      const live = profileLiveReason(profileDir, Date.now());
      if (live) return { bytesFreed, count, refused: live };
    }
    const b = sizeOfTree(full);
    if (!dryRun) {
      try { rmPath(full); } catch { continue; }
    }
    bytesFreed += b;
    count++;
  }
  return { bytesFreed, count };
}

export function hasCargoSweep() {
  try {
    execFileSync("cargo", ["sweep", "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runCargoSweep(projectDir) {
  execFileSync("cargo", ["sweep", "--time", "7", projectDir], { stdio: "inherit" });
}

// ---- the enforcer ------------------------------------------------------------

const AGE_LABEL = (ms) => (ms >= DAY_MS ? `${Math.round(ms / DAY_MS)} d` : ms > 0 ? `${Math.round(ms / 3600e3)} h` : "any age");

/**
 * Bring the combined footprint back under `budgetBytes`.
 *
 * @returns {{status:"under"|"pruned"|"over"|"unmeasured", totalBytes, budgetBytes,
 *            freedBytes, evictions:[], refusals:[{target,reason}], unmeasured:[], notes:[]}}
 *   "unmeasured" — at least one target could not be measured. The known total is
 *   a LOWER BOUND; the result never reads as under budget.
 */
export function enforceBudget(root, opts = {}) {
  const budgetBytes = opts.budgetBytes ?? BUDGET;
  const trigger = opts.trigger ?? "manual";
  const dryRun = !!opts.dryRun;
  const now = opts.now ?? Date.now();
  const print = opts.print ?? ((l) => process.stderr.write(l + "\n"));
  const record = (row) => {
    if (!dryRun) return recordEviction({ trigger, ...row }, { path: opts.logPath, print, now: opts.now });
    print(`[hygiene] would evict ${row.category} ${formatBytes(row.bytesFreed)} from ${row.target} — ${row.reason}`);
    return { trigger, ...row, dryRun: true };
  };

  const snap = measureAll(root, { ...opts, persist: false, now });
  const result = {
    status: "under", budgetBytes, totalBytes: snap.totalBytes, startBytes: snap.totalBytes,
    freedBytes: 0, evictions: [], refusals: [], unmeasured: snap.unmeasured,
    notes: [...snap.discoveryWarnings],
  };
  const finish = () => {
    if (result.unmeasured.length) result.status = "unmeasured";
    else if (result.totalBytes > budgetBytes) result.status = "over";
    else result.status = result.freedBytes > 0 ? "pruned" : "under";
    if (!dryRun && opts.persist !== false) {
      snap.totalBytes = snap.items.reduce((s, i) => s + i.bytes, 0);
      snap.lastEnforce = {
        at: now, trigger, status: result.status, freedBytes: result.freedBytes,
        refusals: result.refusals.slice(0, 5),
      };
      writeCache(root, snap);
    }
    return result;
  };
  if (snap.totalBytes <= budgetBytes) return finish();

  // Workspace crate names, per checkout. No names -> stage (a) is skipped LOUDLY.
  const cratesCache = new Map();
  const cratesFor = (item) => {
    if (item.kind === "temp") return null; // unknown workspace: never guess names
    const srcTauri = item.worktree
      ? join(root, ".claude", "worktrees", item.worktree, "src-tauri")
      : join(root, "src-tauri");
    for (const dir of [srcTauri, join(root, "src-tauri")]) {
      if (cratesCache.has(dir)) return cratesCache.get(dir);
      try {
        const c = (opts.workspaceCrates ?? workspaceCrates)(dir);
        if (c.length) { cratesCache.set(dir, c); return c; }
      } catch {
        /* try the main checkout's manifest */
      }
    }
    return null;
  };

  // Oldest target first inside every stage; measurable, existing targets only.
  const items = snap.items.filter((i) => i.ok && i.bytes > 0).sort((a, b) => a.mtime - b.mtime);
  const refusedTargets = new Set();
  const over = () => result.totalBytes - budgetBytes;
  const credit = (item, freed) => {
    item.bytes = Math.max(0, item.bytes - freed);
    result.totalBytes = Math.max(0, result.totalBytes - freed);
    result.freedBytes += freed;
  };
  const refuse = (item, reason) => {
    if (refusedTargets.has(item.label)) return;
    refusedTargets.add(item.label);
    result.refusals.push({ target: item.label, reason });
    print(`[hygiene] refused ${item.label} — ${reason}`);
  };

  const perProfileStage = (category, fn, reasonOf) => {
    for (const item of items) {
      if (over() <= 0) return;
      if (refusedTargets.has(item.label)) continue;
      for (const profileDir of findProfileDirs(item.path)) {
        if (over() <= 0) return;
        if (!dryRun) {
          const live = profileLiveReason(profileDir, Date.now());
          if (live) { refuse(item, live); break; }
        }
        const r = fn(profileDir, item);
        if (!r) continue;
        if (r.skipped) result.notes.push(`${item.label}: ${r.skipped}`);
        if (r.bytesFreed > 0 || r.count > 0) {
          credit(item, r.bytesFreed);
          const where = `${item.label}/${relative(item.path, profileDir).replace(/\\/g, "/")}`;
          result.evictions.push(record({ target: where, category, bytesFreed: r.bytesFreed, reason: reasonOf(r) }));
        }
        if (r.refused) { refuse(item, r.refused); break; }
      }
    }
  };

  const overBy = () => `over the ${(budgetBytes / GIB).toFixed(budgetBytes >= GIB ? 0 : 4)} GiB budget`;
  const depsStage = (minAgeMs) => perProfileStage(
    "deps-superseded",
    (p, item) => {
      const crates = cratesFor(item);
      if (!crates) {
        if (item.kind !== "temp") result.notes.push(`${item.label}: workspace crate names could not be derived — superseded-deps reaper skipped`);
        return null;
      }
      return reapSupersededDeps(p, crates, { minAgeMs, now, dryRun, maxBytes: over() });
    },
    (r) => `${r.count} superseded hash-set(s) of ${r.crates} workspace crate(s), older than ${AGE_LABEL(minAgeMs)}; newest ${KEEP_HASH_SETS} per crate+shape kept; footprint ${overBy()}`,
  );
  const incStage = (minAgeMs) => perProfileStage(
    "incremental",
    (p) => reapIncremental(p, { minAgeMs, now, dryRun, maxBytes: over() }),
    (r) => `${r.count} incremental session dir(s) older than ${AGE_LABEL(minAgeMs)}; footprint ${overBy()}`,
  );

  depsStage(3 * DAY_MS);
  if (over() > 0) incStage(3 * DAY_MS);
  if (over() > 0) depsStage(DAY_MS);
  if (over() > 0) incStage(DAY_MS);
  if (over() > 0) depsStage(0);

  // (c) cargo sweep — first stage allowed to touch third-party artifacts.
  if (over() > 0 && !dryRun) {
    const sweepAvailable = (opts.hasCargoSweep ?? hasCargoSweep)();
    if (!sweepAvailable) {
      result.notes.push("cargo-sweep not installed — stage (c) skipped (cargo install cargo-sweep)");
    } else {
      for (const item of items) {
        if (over() <= 0) break;
        if (refusedTargets.has(item.label)) continue;
        if (item.kind !== "main" && !(item.kind === "worktree" && basename(item.path) === "target")) continue;
        const projectDir = dirname(item.path);
        if (!existsSync(join(projectDir, "Cargo.toml"))) continue;
        const live = targetLiveReason(item.path, Date.now());
        if (live) { refuse(item, live); continue; }
        try {
          (opts.runCargoSweep ?? runCargoSweep)(projectDir);
        } catch (e) {
          result.notes.push(`${item.label}: cargo sweep failed: ${e.message}`);
          continue;
        }
        const after = (opts.measure ?? measureDirStrict)(item.path);
        if (!after.ok) {
          result.unmeasured.push({ label: item.label, error: after.error });
          continue;
        }
        const freed = Math.max(0, item.bytes - after.bytes);
        if (freed > 0) {
          credit(item, freed);
          result.evictions.push(record({
            target: item.label, category: "cargo-sweep", bytesFreed: freed,
            reason: `cargo sweep --time 7 (artifacts unused for 7 d); footprint ${overBy()} after superseded-deps + incremental stages`,
          }));
        }
      }
    }
  }

  // (d) orphaned build/ out-dirs.
  if (over() > 0) {
    perProfileStage(
      "build-orphan",
      (p) => reapBuildOrphans(p, { now, dryRun, maxBytes: over() }),
      (r) => `${r.count} build/ out-dir(s) with no .fingerprint entry; footprint ${overBy()}`,
    );
  }

  // (e) whole worktree targets — only when a human asked for it.
  if (over() > 0 && trigger === "manual") {
    for (const item of items.filter((i) => i.kind === "worktree")) {
      if (over() <= 0) break;
      if (refusedTargets.has(item.label) || item.bytes === 0) continue;
      if (!dryRun) {
        const live = targetLiveReason(item.path, Date.now());
        if (live) { refuse(item, live); continue; }
        try { rmPath(item.path); } catch (e) { result.notes.push(`${item.label}: ${e.message}`); continue; }
      }
      const freed = item.bytes;
      credit(item, freed);
      result.evictions.push(record({
        target: item.label, category: "worktree-target", bytesFreed: freed,
        reason: `whole worktree target removed by manual --enforce (regenerates on its next build); footprint ${overBy()}`,
      }));
    }
  }

  if (over() > 0) {
    result.notes.push(
      `still ${formatBytes(over())} over budget after every safe stage — a stale profile dir or a full reset (npm run clean:rust) is needed; cargo clean is never run automatically`,
    );
  }
  return finish();
}

// ---- CLI modes ---------------------------------------------------------------

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

function report(root, asJson) {
  const snap = measureAll(root);
  if (asJson) {
    process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
    return;
  }
  const sorted = [...snap.items].sort((a, b) => b.bytes - a.bytes);
  process.stdout.write(`\nRust build cache — budget ${BUDGET_GB} GB (enforced)\n`);
  process.stdout.write("".padEnd(76, "-") + "\n");
  for (const i of sorted) {
    const size = i.ok ? gb(i.bytes).padStart(11) : `${C.red}UNMEASURED${C.reset} `;
    process.stdout.write(`  ${i.label.padEnd(44)} ${i.kind.padEnd(22)} ${size}\n`);
    if (!i.ok) process.stdout.write(`${C.red}      ${i.error}${C.reset}\n`);
  }
  for (const w of snap.discoveryWarnings) process.stdout.write(`${C.yellow}  ! ${w}${C.reset}\n`);
  const col = snap.unmeasured.length ? C.red : statusColor(snap.totalBytes);
  const pct = ((snap.totalBytes / BUDGET) * 100).toFixed(0);
  process.stdout.write("".padEnd(76, "-") + "\n");
  process.stdout.write(`  ${col}TOTAL${snap.unmeasured.length ? " (lower bound)" : ""}  ${gb(snap.totalBytes)}  —  ${pct}% of budget${C.reset}\n\n`);
  if (snap.unmeasured.length) {
    process.stdout.write(`${C.red}${snap.unmeasured.length} target(s) could not be measured — this is NOT a clean bill.${C.reset}\n\n`);
  } else if (snap.totalBytes > BUDGET) {
    process.stdout.write(`${C.yellow}Over budget. Reclaim now: npm run clean:cache   History: npm run hygiene:log${C.reset}\n\n`);
  }
}

function printResult(r, out = process.stdout) {
  for (const n of r.notes) out.write(`${C.dim}  note: ${n}${C.reset}\n`);
  if (r.status === "unmeasured") {
    out.write(`${C.red}COULD NOT MEASURE ${r.unmeasured.length} target(s): ${r.unmeasured.map((u) => `${u.label} (${u.error})`).join("; ")}\n` +
      `Known footprint is AT LEAST ${gb(r.totalBytes)}; this is not an under-budget result.${C.reset}\n`);
  } else if (r.status === "over") {
    out.write(`${C.yellow}Still ${gb(r.totalBytes - r.budgetBytes)} over budget (${gb(r.totalBytes)}); freed ${gb(r.freedBytes)}.` +
      `${r.refusals.length ? ` ${r.refusals.length} target(s) refused (build live).` : ""}${C.reset}\n`);
  } else if (r.status === "pruned") {
    out.write(`${C.green}Done — freed ${gb(r.freedBytes)}; cache back under budget (${gb(r.totalBytes)}).${C.reset}\n`);
  } else {
    out.write(`${C.green}Cache at ${gb(r.totalBytes)} — under the ${BUDGET_GB} GB budget. Nothing to do.${C.reset}\n`);
  }
}

async function enforceCli(root) {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !(await confirm(`Prune Rust build caches back under the ${BUDGET_GB} GB budget?`))) {
    process.stdout.write("Aborted.\n");
    return 1;
  }
  const r = enforceBudget(root, { trigger: "manual", dryRun, print: (l) => process.stdout.write(l + "\n") });
  printResult(r);
  // Loud: a manual enforce that could not measure, or could not get under, failed.
  return r.status === "unmeasured" ? 2 : r.status === "over" ? 1 : 0;
}

// Delete every incremental/ cache under the main target. Pure rebuild
// accelerator — safe to remove whenever nothing is compiling.
function pruneIncrementalCli(root) {
  const mainTarget = join(root, "src-tauri", "target");
  const live = targetLiveReason(mainTarget);
  if (live) {
    process.stderr.write(`${C.yellow}Refused: ${live}. Re-run when the build has finished.${C.reset}\n`);
    return 1;
  }
  let freed = 0;
  for (const p of findProfileDirs(mainTarget)) {
    const r = reapIncremental(p, { minAgeMs: 0 });
    if (r.bytesFreed > 0) {
      recordEviction({
        trigger: "manual", target: `main/${relative(mainTarget, p).replace(/\\/g, "/")}`, category: "incremental",
        bytesFreed: r.bytesFreed, reason: `${r.count} incremental session dir(s), all ages — npm run clean:incremental`,
      }, { print: (l) => process.stdout.write(l + "\n") });
    }
    freed += r.bytesFreed;
  }
  process.stdout.write(`${C.green}Pruned ${gb(freed)} of incremental cache.${C.reset}\n`);
  return 0;
}

function spawnBackground(flag) {
  const child = spawn(process.execPath, [SELF, flag], {
    detached: true, stdio: "ignore", windowsHide: true, env: process.env,
  });
  child.unref();
}

/**
 * The guard's decision, as data — no I/O beyond the snapshot it is handed.
 * Exported so the "no directory walk when under budget" property is testable.
 * @returns {{action:"silent"|"background"|"advise", line?:string}}
 */
export function guardDecision(cache, { now = Date.now(), budgetBytes = BUDGET, budgetGB = BUDGET_GB, autoPrune = AUTO_PRUNE } = {}) {
  const pct = (b) => ((b / budgetBytes) * 100).toFixed(0);
  if (!cache || typeof cache.totalBytes !== "number" || typeof cache.measuredAt !== "number") {
    return { action: autoPrune ? "background" : "advise", why: "no measurement exists yet" };
  }
  const ageMs = now - cache.measuredAt;
  const incomplete = Array.isArray(cache.unmeasured) && cache.unmeasured.length > 0;
  // A v1 snapshot has no `kind` on its items: it never looked at the alternate
  // or %TEMP% targets, so its total is a partial one.
  const partial = !Array.isArray(cache.items) || cache.items.some((i) => !i.kind);
  let why = null;
  if (incomplete) why = `last measurement could not read ${cache.unmeasured.map((u) => u.label).join(", ")}`;
  else if (partial) why = "last measurement predates full target discovery";
  else if (ageMs > GUARD_TTL_MS) why = `last measurement is ${Math.round(ageMs / 3600e3)} h old`;
  else if (cache.totalBytes >= budgetBytes * WARN_RATIO) why = `last measurement ${gb(cache.totalBytes)} / ${budgetGB} GB (${pct(cache.totalBytes)}%)`;
  if (!why) return { action: "silent" };
  return { action: autoPrune ? "background" : "advise", why, alarm: cache.totalBytes >= HARD_CEILING };
}

// Is this file the main checkout's copy (or an explicitly redirected run)?
//
// A WORKTREE's copy of this script must never auto-enforce. The root it polices
// is the MAIN checkout's — shared by every session on the machine — while the
// code doing the policing is whatever that branch happens to contain: possibly
// unreviewed, possibly stale. Measured 2026-09-18, the day this was written: a
// predev run inside the very worktree where v2 was being developed spawned the
// background enforcer against the real 95 GB target and evicted 9.77 GB before
// review. The evictions were the designed ones and the live-build refusal held,
// but unreviewed code had deleted from a shared tree. So from a worktree the
// guard only advises; enforcement comes from the main checkout's guard, the
// daily task, or an explicit `--enforce`.
export function guardMayEnforce(root, { self = SELF, env = process.env } = {}) {
  if (env.CACHE_BUDGET_ROOT) return true; // explicit redirect (tests, timing runs)
  const norm = (x) => resolve(x).split("\\").join("/").toLowerCase();
  return norm(resolve(dirname(self), "..")) === norm(root);
}

function guard(root) {
  // The common path: one small JSON read. No discovery, no walk, no child.
  const cache = readCache(root);
  const d = guardDecision(cache, { autoPrune: AUTO_PRUNE && guardMayEnforce(root) });
  if (d.action === "silent") process.exit(0);

  const col = d.alarm ? C.red : C.yellow;
  if (d.alarm) {
    process.stderr.write(`${C.red}[cache-budget] ALARM: Rust build cache past the ${HARD_CEILING_GB} GB ceiling — enforcement is NOT holding the ${BUDGET_GB} GB budget. Run: npm run clean:cache${C.reset}\n`);
  }
  if (d.action === "advise") {
    const because = AUTO_PRUNE ? "a worktree's copy of the guard never enforces" : "CACHE_AUTO_PRUNE=0";
    process.stderr.write(`${col}[cache-budget] ${d.why}. Nothing is evicted from here (${because}). Reclaim: npm run clean:cache${C.reset}\n`);
    process.exit(0);
  }
  let handedOff = true;
  try {
    spawnBackground("--guard-background");
  } catch (e) {
    handedOff = false;
    process.stderr.write(`${C.red}[cache-budget] ${d.why}, and the background enforcer could not start (${e.message}). Budget NOT checked. Run: npm run clean:cache${C.reset}\n`);
  }
  if (handedOff) {
    process.stderr.write(`${col}[cache-budget] ${d.why} — measuring fresh and enforcing the ${BUDGET_GB} GB budget in the background (evictions: npm run hygiene:log).${C.reset}\n`);
  }
  const last = cache?.lastEnforce;
  if (last && (last.status === "over" || last.status === "unmeasured")) {
    const because = last.refusals?.length ? ` — ${last.refusals[0].target}: ${last.refusals[0].reason}` : "";
    process.stderr.write(`${C.dim}  previous enforcement (${last.trigger}) ended "${last.status}"${because}${C.reset}\n`);
  }
  process.exit(0); // the guard must never fail the build
}

// Detached half of the guard. Single-instance; retries while a build is live.
async function guardBackground(root) {
  const lock = join(root, ".claude", ".cache-budget.lock");
  try {
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60 * 60 * 1000) unlinkSync(lock);
    closeSync(openSync(lock, "wx"));
  } catch {
    return 0; // another enforcer is already on it
  }
  try {
    const deadline = Date.now() + GUARD_WAIT_MIN * 60_000;
    for (;;) {
      const r = enforceBudget(root, { trigger: "guard", print: () => {} });
      const blockedByBuild = r.status === "over" && r.refusals.length > 0;
      if (!blockedByBuild || Date.now() >= deadline) return 0;
      await new Promise((res) => setTimeout(res, 60_000));
    }
  } finally {
    try { unlinkSync(lock); } catch { /* ignore */ }
  }
}

// ---- entrypoint --------------------------------------------------------------

// Windows paths are case-insensitive (drive letter especially); compare folded.
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const isMain = !!process.argv[1] && samePath(resolve(process.argv[1]), SELF);
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const root = mainRepoRoot();

  if (args.has("--measure-only")) {
    measureAll(root);
    process.exit(0);
  } else if (args.has("--guard-background")) {
    if (!AUTO_PRUNE || !guardMayEnforce(root)) process.exit(0); // same rule as the guard itself
    guardBackground(root).then((c) => process.exit(c)).catch(() => process.exit(0));
  } else if (args.has("--prune-incremental")) {
    process.exit(pruneIncrementalCli(root));
  } else if (args.has("--enforce")) {
    // "Looked at nothing" is not "under budget": an empty discovery means the root is wrong
    // or the walk broke, and a manual enforce must say so rather than report a clean 0 B.
    const discovered = discoverTargetsDetailed({ root, tmpdir: process.env.CACHE_BUDGET_TMPDIR || undefined }).targets;
    if (discovered.length === 0) {
      process.stderr.write(`cache-budget: no cargo target discovered under ${root} - nothing was checked\n`);
      process.exit(1);
    }
    enforceCli(root).then((code) => process.exit(code)).catch((e) => {
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
}
