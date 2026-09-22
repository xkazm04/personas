// Discovery of every cargo target / build directory this project can grow.
//
// ONE list, used by the budget enforcer (scripts/cache-budget.mjs), the daily
// hygiene task (scripts/hygiene/run-daily.mjs) and `npm run cache:report`.
//
// WHY THIS IS ITS OWN MODULE
// --------------------------
// Until 2026-09-18 the list lived inside cache-budget.mjs as `listTargets()` and
// knew two shapes: `src-tauri/target` and `.claude/worktrees/*/src-tauri/target`.
// A budget can only cap what it can see, and it could not see:
//   - src-tauri/target-clippy      (the clippy lane's own target, so a lint run
//                                   does not evict the dev build's artifacts)
//   - src-tauri/target-bindings    (used when tauri dev holds the primary target)
//   - .personas-e2e-target         (isolated e2e/tours build)
//   - .rp-check-target             (gitignored at .gitignore:142; purpose
//                                   undocumented there — counted, not explained)
//   - cargo targets that unattended workers point at %TEMP% — 9 GB measured
//     2026-09-14, none of it counted against any budget.
// "Under budget" reported over a partial list is a statement about the list,
// not about the disk.
//
// A target in %TEMP% is recognised by content, not by name: a directory holding
// BOTH `CACHEDIR.TAG` and `.rustc_info.json` is a cargo target root (cargo writes
// both on first use). The walk is bounded — depth <= 2 under the temp root and a
// hard cap (50,000) on directories visited — because %TEMP% here has held ~70,000
// top-level entries and this runs unattended. Hitting the cap is reported as a
// warning, never swallowed: a truncated walk did not see everything.
//
// Pure: every root is injectable, nothing is deleted, nothing is measured.

import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";

/** Alternate target dirs, relative to a checkout root. */
export const ALTERNATE_TARGETS = [
  "src-tauri/target-clippy",
  "src-tauri/target-bindings",
  ".personas-e2e-target",
  ".rp-check-target",
];

/** Shared worktree build-dir (`build.build-dir`), introduced by a later package. */
export const SHARED_WORKTREE_BUILD_DIR = ".claude/worktrees/.cargo-build";

// 50,000: %TEMP% on this host has held ~70,000 top-level entries, and the first
// real v2 measurement (2026-09-18) stopped at the earlier 20,000 cap. Still
// bounded — this runs unattended — and the daily task sweeps stale temp targets
// BEFORE the enforcer's discovery so the walk shrinks over time.
export const TEMP_WALK_MAX_DIRS = 50_000;

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** A cargo target root, recognised by the two files cargo itself writes there. */
export function isCargoTargetRoot(dir) {
  return existsSync(join(dir, "CACHEDIR.TAG")) && existsSync(join(dir, ".rustc_info.json"));
}

function mtimeOf(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Cargo targets directly under `tmp`, at depth 1 or 2. Bounded; a directory it
 * cannot list is skipped (it is somebody else's, and unreadable is not ours to
 * judge) but the cap being hit is surfaced.
 */
export function discoverTempTargets(tmp, { maxDirs = TEMP_WALK_MAX_DIRS } = {}) {
  const found = [];
  const warnings = [];
  let visited = 0;
  let truncated = false;

  function children(dir) {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.isSymbolicLink())
        .map((e) => join(dir, e.name));
    } catch {
      return [];
    }
  }

  if (!tmp || !isDir(tmp)) {
    warnings.push(`temp root not readable: ${tmp ?? "(unset)"} — temp targets NOT checked`);
    return { targets: found, warnings };
  }

  outer: for (const d1 of children(tmp)) {
    if (++visited > maxDirs) { truncated = true; break; }
    if (isCargoTargetRoot(d1)) {
      found.push(d1);
      continue; // a target's own subdirs are not further targets
    }
    for (const d2 of children(d1)) {
      if (++visited > maxDirs) { truncated = true; break outer; }
      if (isCargoTargetRoot(d2)) found.push(d2);
    }
  }
  if (truncated) {
    warnings.push(`temp walk stopped at ${maxDirs} directories under ${tmp} — temp targets beyond that were NOT checked`);
  }
  return { targets: found, warnings };
}

/**
 * Every cargo target / build dir for the checkout at `root`.
 *
 * @returns {{ targets: Array<{label:string, path:string, kind:string, worktree:string|null, mtime:number}>, warnings: string[] }}
 *   kind: "main" | "alternate" | "worktree" | "worktree-shared-build" | "temp"
 *   `main` is always listed (even when absent) so a report never silently drops
 *   the one everybody expects; every other entry is listed only if it exists.
 */
export function discoverTargetsDetailed({ root, tmpdir = osTmpdir(), includeTemp = true, maxTempDirs } = {}) {
  if (!root) throw new Error("discoverTargets: root is required");
  const targets = [];
  const warnings = [];

  targets.push({ label: "main", kind: "main", worktree: null, path: join(root, "src-tauri", "target") });

  for (const rel of ALTERNATE_TARGETS) {
    const p = join(root, ...rel.split("/"));
    if (isDir(p)) targets.push({ label: `alternate:${rel}`, kind: "alternate", worktree: null, path: p });
  }

  const shared = join(root, ...SHARED_WORKTREE_BUILD_DIR.split("/"));
  if (isDir(shared)) {
    targets.push({ label: "worktree-shared-build", kind: "worktree-shared-build", worktree: null, path: shared });
  }

  const wtBase = join(root, ".claude", "worktrees");
  if (isDir(wtBase)) {
    let names = [];
    try {
      names = readdirSync(wtBase, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== ".cargo-build")
        .map((e) => e.name);
    } catch (e) {
      warnings.push(`could not list ${wtBase}: ${e.message} — worktree targets NOT checked`);
    }
    for (const name of names) {
      for (const rel of ["src-tauri/target", ...ALTERNATE_TARGETS]) {
        const p = join(wtBase, name, ...rel.split("/"));
        if (!isDir(p)) continue;
        const label = rel === "src-tauri/target" ? `worktree:${name}` : `worktree:${name}:${rel}`;
        targets.push({ label, kind: "worktree", worktree: name, path: p });
      }
    }
  }

  if (includeTemp) {
    const t = discoverTempTargets(tmpdir, maxTempDirs ? { maxDirs: maxTempDirs } : undefined);
    warnings.push(...t.warnings);
    for (const p of t.targets) {
      targets.push({ label: `temp:${p.slice(tmpdir.length + 1).replace(/\\/g, "/")}`, kind: "temp", worktree: null, path: p });
    }
  }

  for (const t of targets) t.mtime = mtimeOf(t.path);
  return { targets, warnings };
}

/** Convenience: just the list. Use the Detailed form when warnings matter. */
export function discoverTargets(opts) {
  return discoverTargetsDetailed(opts).targets;
}

/**
 * Profile directories inside a target: `<target>/<profile>` and
 * `<target>/<triple>/<profile>`. Recognised by content (`deps/`, `incremental/`
 * or `.fingerprint/`), so custom profiles (`dev-release`, `ci`, `stable`) and
 * cross-compile triples need no list here.
 */
export function findProfileDirs(targetRoot) {
  const out = [];
  const looksLikeProfile = (d) =>
    isDir(join(d, "deps")) || isDir(join(d, "incremental")) || isDir(join(d, ".fingerprint"));
  let level1 = [];
  try {
    level1 = readdirSync(targetRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return out;
  }
  for (const e of level1) {
    const d1 = join(targetRoot, e.name);
    if (looksLikeProfile(d1)) { out.push(d1); continue; }
    let level2 = [];
    try {
      level2 = readdirSync(d1, { withFileTypes: true }).filter((x) => x.isDirectory());
    } catch {
      continue;
    }
    for (const x of level2) {
      const d2 = join(d1, x.name);
      if (looksLikeProfile(d2)) out.push(d2);
    }
  }
  return out;
}
