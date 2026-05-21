#!/usr/bin/env node
// Garbage-collect stale agent worktrees under .claude/worktrees/.
//
// Each entry there is a full git worktree created for a parallel agent run.
// Nothing cleans them up: the directory — and its multi-GB src-tauri/target —
// lingers long after the branch is merged. This lists every worktree with its
// age / dirty / merged status + size and removes the ones that are safe to
// drop. It also clears stale git refs (worktrees whose directory is gone) and,
// opt-in, orphaned directories that git no longer tracks.
//
// Usage:
//   node scripts/worktree-gc.mjs                 # dry-run: report only
//   node scripts/worktree-gc.mjs --force         # actually remove
//   node scripts/worktree-gc.mjs --days=30       # age threshold (default 14)
//   node scripts/worktree-gc.mjs --include-orphans   # also drop untracked dirs
//   node scripts/worktree-gc.mjs --json
//
// A REGISTERED worktree is removable when it is all of:
//   - clean   — no uncommitted changes
//   - merged  — its HEAD is an ancestor of origin/master (or master)
//   - stale   — directory mtime older than --days
// A worktree with uncommitted changes is NEVER removed.
//
// Removing a worktree deletes only its working directory + build cache; the
// branch and its commits stay in the repo. Stale refs are always pruned.
// Orphaned directories (on disk but absent from `git worktree list`) are only
// removed with --include-orphans, because git can't vouch for their contents.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GIB = 1024 ** 3;
const C = {
  reset: "\x1b[0m", yellow: "\x1b[33m", red: "\x1b[31m",
  green: "\x1b[32m", dim: "\x1b[2m", cyan: "\x1b[36m",
};

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const JSON_OUT = args.includes("--json");
const INCLUDE_ORPHANS = args.includes("--include-orphans");
const DAYS = (() => {
  const a = args.find((x) => x.startsWith("--days="));
  return a ? Number(a.slice(7)) : 14;
})();

function gb(bytes) {
  return `${(bytes / GIB).toFixed(2)} GB`;
}

function git(root, gitArgs, opts = {}) {
  return execFileSync("git", ["-C", root, ...gitArgs], {
    encoding: "utf8", ...opts,
  });
}

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
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

// Windows paths are case-insensitive and git prints them with forward slashes;
// normalise both so registered-worktree matching is reliable.
function normPath(p) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

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
      /* skip */
    }
  }
  return bytes;
}

// Parse `git worktree list --porcelain` into { path, head, branch, locked }.
function listRegisteredWorktrees(root) {
  let out;
  try {
    out = git(root, ["worktree", "list", "--porcelain"]);
  } catch {
    return [];
  }
  const trees = [];
  let cur = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice(9).trim(), head: null, branch: null, locked: false };
      trees.push(cur);
    } else if (cur && line.startsWith("HEAD ")) {
      cur.head = line.slice(5).trim();
    } else if (cur && line.startsWith("branch ")) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    } else if (cur && line.startsWith("locked")) {
      cur.locked = true;
    }
  }
  return trees;
}

// The ref worktrees are expected to have merged into: prefer origin/master.
function defaultRef(root) {
  for (const ref of ["origin/master", "master", "origin/main", "main"]) {
    try {
      git(root, ["rev-parse", "--verify", "--quiet", ref], { stdio: ["ignore", "ignore", "ignore"] });
      return ref;
    } catch {
      /* try next */
    }
  }
  return null;
}

function isMerged(root, head, ref) {
  if (!head || !ref) return false;
  try {
    git(root, ["merge-base", "--is-ancestor", head, ref], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Uncommitted-change count for a registered worktree. Run from the worktree
// itself so git reports that tree (not the primary repo's).
function dirtyCount(worktreePath) {
  try {
    const out = execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], {
      encoding: "utf8",
    });
    return out.split("\n").filter((l) => l.trim()).length;
  } catch {
    return -1; // unknown — treat as "do not touch"
  }
}

function ageDays(path) {
  try {
    return (Date.now() - statSync(path).mtimeMs) / 86_400_000;
  } catch {
    return 0;
  }
}

// ---- main ------------------------------------------------------------------

const root = mainRepoRoot();
const wtBase = join(root, ".claude", "worktrees");
const ref = defaultRef(root);
const registered = listRegisteredWorktrees(root);
const registeredByPath = new Map(registered.map((w) => [normPath(w.path), w]));

const onDisk = existsSync(wtBase)
  ? readdirSync(wtBase, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];

const rows = [];

// 1. Directories present under .claude/worktrees/.
for (const name of onDisk) {
  const path = join(wtBase, name);
  const reg = registeredByPath.get(normPath(path));
  const size = measureDir(path);
  const age = ageDays(path);

  if (!reg) {
    rows.push({
      name, path, size, age,
      kind: "orphan", dirty: null, merged: null,
      removable: INCLUDE_ORPHANS,
      note: "not tracked by git — inspect before removing",
    });
    continue;
  }

  const dirty = dirtyCount(path);
  const merged = isMerged(root, reg.head, ref);
  const removable = dirty === 0 && merged && age > DAYS;
  let note = "";
  if (dirty > 0) note = `${dirty} uncommitted file(s) — kept`;
  else if (dirty < 0) note = "status unknown — kept";
  else if (!merged) note = `not merged into ${ref ?? "default branch"} — kept`;
  else if (age <= DAYS) note = `only ${age.toFixed(0)}d old (< ${DAYS}d) — kept`;
  else note = "clean + merged + stale";

  rows.push({
    name, path, size, age, kind: "worktree",
    dirty, merged, branch: reg.branch, locked: reg.locked, removable, note,
  });
}

// 2. Registered worktrees whose directory no longer exists — stale refs.
for (const w of registered) {
  if (normPath(dirname(w.path)) !== normPath(wtBase)) continue; // skip primary + foreign
  if (existsSync(w.path)) continue;
  rows.push({
    name: w.path.split(/[\\/]/).pop(), path: w.path, size: 0, age: 0,
    kind: "stale-ref", dirty: null, merged: null, removable: true,
    note: "directory missing — git ref will be pruned",
  });
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ root, ref, days: DAYS, rows }, null, 2) + "\n");
  process.exit(0);
}

// ---- report ----------------------------------------------------------------

process.stdout.write(`\nWorktree GC — ${wtBase}\n`);
process.stdout.write(`default branch: ${ref ?? "(none found)"}   age threshold: ${DAYS}d\n`);
process.stdout.write("".padEnd(78, "-") + "\n");

const removable = rows.filter((r) => r.removable);
const kept = rows.filter((r) => !r.removable);

for (const r of [...removable, ...kept]) {
  const mark = r.removable ? `${C.red}DROP${C.reset}` : `${C.green}keep${C.reset}`;
  const size = r.size ? gb(r.size).padStart(10) : "".padStart(10);
  process.stdout.write(`  ${mark}  ${r.name.padEnd(34)} ${size}  ${C.dim}${r.note}${C.reset}\n`);
}
process.stdout.write("".padEnd(78, "-") + "\n");

const reclaim = removable.reduce((s, r) => s + r.size, 0);
process.stdout.write(`  ${removable.length} removable · reclaims ~${gb(reclaim)}\n\n`);

if (removable.length === 0) {
  process.stdout.write(`${C.green}Nothing to remove.${C.reset}\n\n`);
  process.exit(0);
}

if (!FORCE) {
  process.stdout.write(`${C.yellow}Dry run — re-run with --force to remove the ${removable.length} item(s) above.${C.reset}\n`);
  if (rows.some((r) => r.kind === "orphan" && !INCLUDE_ORPHANS)) {
    process.stdout.write(`${C.dim}Orphaned directories exist; add --include-orphans to drop those too.${C.reset}\n`);
  }
  process.stdout.write("\n");
  process.exit(0);
}

// ---- removal ---------------------------------------------------------------

let removed = 0;
for (const r of removable) {
  try {
    if (r.kind === "orphan") {
      rmSync(r.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } else {
      // --force: worktrees carry untracked build artifacts git would refuse
      // to discard otherwise. Branch + commits survive; only the tree goes.
      git(root, ["worktree", "remove", "--force", r.path], { stdio: "inherit" });
    }
    process.stdout.write(`  ${C.green}removed${C.reset} ${r.name}\n`);
    removed += 1;
  } catch (e) {
    process.stderr.write(`  ${C.red}failed${C.reset} ${r.name}: ${e.message}\n`);
  }
}

try {
  git(root, ["worktree", "prune"]);
} catch {
  /* non-fatal */
}

process.stdout.write(`\n${C.green}Removed ${removed}/${removable.length} item(s).${C.reset}\n\n`);
