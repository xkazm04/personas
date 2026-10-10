#!/usr/bin/env node
/**
 * Where the build disk went — and the one deletion that is provably safe.
 *
 * `npm run build:disk`                  rank every build cache by size and age
 * `npm run build:disk -- --json`        the same, machine-readable
 * `npm run build:disk -- --verify`      measure every row a SECOND way and compare
 * `npm run build:disk -- --reap`        delete the orphan-worktree targets, only
 *
 * WHY THIS EXISTS (2026-10-07). Disk leaks monotonically here: cargo never
 * garbage-collects a target dir, and every worktree grows its own. Measured
 * today: `src-tauri/target` **48.8 GB**, `src-tauri/target-wt` another **13 GB**
 * in the same checkout, and `docs/development/build-cache.md` records the main
 * target reaching **324 GB** with `deps/` holding **1,766 hash-sets of
 * `personas_db`** alone.
 *
 * HOW THIS DIFFERS FROM `npm run cache:report`, WHICH YOU SHOULD PREFER FOR THE
 * BUDGET. `scripts/cache-budget.mjs --report` is the 60 GiB budget's own view and
 * is the authority on it; this script is the *disk forensics* view beside it, and
 * it adds four things that one does not have:
 *   1. **age beside size**, so the ranking answers "what is big AND cold".
 *   2. **the sccache store**, which is a build cache the budget does not know
 *      about at all (it is machine-wide, outside any checkout, and self-pruning).
 *   3. **targets the budget cannot see.** `scripts/hygiene/targets.mjs` knows
 *      four alternate target names; it does not know `target-wt`. Measured today:
 *      `src-tauri/target-wt` (13 GB), `.claude/worktrees/prototype-athena-chat/src-tauri/target-wt`
 *      and `.../prototype-contact-sheet/src-tauri/target-wt1` are all real cargo
 *      target roots and all **invisible to the budget**. This script finds them by
 *      content — `src-tauri/target*` holding both `CACHEDIR.TAG` and
 *      `.rustc_info.json`, which is targets.mjs's own `isCargoTargetRoot` rule —
 *      and marks each row `invisibleToBudget`. A budget that cannot see a 13 GB
 *      tree is a statement about its list, not about the disk.
 *   4. **the orphan-worktree reaper** below.
 *
 * ─── THE DELETION RULE, AND WHY IT IS THIS NARROW ───────────────────────────
 *
 * **Only a target directory whose worktree no longer exists is deleted.**
 *
 * `git worktree list` says who is live. A target dir under a path that is not a
 * live worktree belongs to nobody: there is no checkout that could use it, no
 * session that could be mid-build in it, and nothing to cold-build again. That is
 * what makes it provable rather than probable.
 *
 * Everything else is **reported with its exact removal command and never
 * touched** — stale-but-live worktrees, the main checkout's `target` and
 * `target-wt`, `incremental/`, `target-clippy`, `target-bindings`,
 * `.personas-e2e-target`, `.rp-check-target`, `%TEMP%` targets, the sccache
 * store. A stale-looking worktree target is somebody's next warm build; the
 * operator decides.
 *
 * The operator was offered an aggressive 7-day-stale auto-reaper and chose this
 * narrower rule deliberately. **Do not widen it.** No `--force` for
 * stale-but-live dirs, no prompt that nudges toward deleting more. This repo has
 * already lost work to an over-eager cleaner twice (the 2026-05-09 `git stash`
 * incident; the 2026-09-18 incident in build-cache.md where a worktree's copy of
 * the budget guard pruned the MAIN checkout's target and cost a real 110 s
 * recompile) and the lesson both times was the same: the cost of keeping 10 GB
 * too long is 10 GB, and the cost of deleting the wrong thing is somebody's work.
 *
 * Even inside that rule the reaper is report-first: `--reap` is required to
 * delete anything, and each candidate is re-checked immediately before removal
 * against `targetLiveReason()` from `scripts/cache-budget.mjs` — the EBUSY
 * `.cargo-lock` read probe plus the incremental-mtime window, the pair that
 * script's own tests exercise. Nothing is re-derived here.
 *
 * ─── MEASUREMENT ────────────────────────────────────────────────────────────
 *
 * `robocopy /L` (list-only, copies nothing), the mechanism
 * `scripts/build/bench.mjs:132-142` already settled on because `du` hangs on
 * this host. `--verify` re-measures with a node `readdirSync({recursive:true})`
 * walk (`measureDirStrict` from cache-budget.mjs) and prints both numbers, so the
 * robocopy figure can be cross-checked rather than trusted.
 *
 * **A size that could not be computed prints `UNMEASURED`, never 0.** Zero bytes
 * because nothing matched and zero bytes because the walk broke are different
 * outcomes, and a reporter that conflates them is how an unreadable 95 GB tree
 * once read as empty (build-cache.md, "Could not check is never clean"). A row
 * that is UNMEASURED is never a reap candidate, and the totals say they are a
 * lower bound.
 *
 * No process enumeration: a bare `tasklist` hangs on this host, and the liveness
 * question is answered by the lock probe, which is cheaper and more precise.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { GIB, mainRepoRoot, measureDirStrict, targetLiveReason } from "../cache-budget.mjs";
import { discoverTargetsDetailed, findProfileDirs, isCargoTargetRoot } from "../hygiene/targets.mjs";
import {
  SCCACHE_CACHE_SIZE,
  findInstalled,
  parseByteSize,
  serverListening,
  serverStats,
} from "./ensure-sccache.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const JSON_OUT = flag("json");
/** Narrow the report to rows whose label or path contains this (case-insensitive). */
const ONLY = opt("only");

const DAY_MS = 86_400_000;

/** Windows paths are case-insensitive; compare folded. Same rule as cache-budget.mjs. */
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const norm = (p) => resolve(p).replace(/[\\/]+$/, "");

/** Human-readable goes to stderr when --json is on, so the JSON stays pipeable. */
const out = (line) => process[JSON_OUT ? "stderr" : "stdout"].write(`${line}\n`);

const gb = (bytes) => (bytes === null ? "UNMEASURED" : `${(bytes / GIB).toFixed(2)} GiB`);
const ageLabel = (ms) =>
  ms === null ? "unknown" : ms >= DAY_MS ? `${Math.round(ms / DAY_MS)} d` : `${Math.round(ms / 3600e3)} h`;

// ─── measurement ────────────────────────────────────────────────────────────

/**
 * Bytes under `dir` via `robocopy /L`, or null when it could not be computed.
 * Lifted from bench.mjs's `dirBytes`; the destination is never created because
 * `/L` only lists. `/XJ` keeps it out of junctions (this repo's worktrees carry
 * `node_modules` junctions — following one double-counts and can loop).
 */
export function robocopyBytes(dir) {
  if (!existsSync(dir)) return 0;
  if (process.platform !== "win32") {
    const r = spawnSync("du", ["-sb", dir], { encoding: "utf8", maxBuffer: 1 << 26 });
    if (r.status !== 0) return null;
    const n = Number((r.stdout || "").split(/\s+/)[0]);
    return Number.isFinite(n) ? n : null;
  }
  const nx = join(tmpdir(), "__build_disk_nx__");
  const r = spawnSync(
    "robocopy",
    [dir, nx, "/L", "/S", "/NJH", "/BYTES", "/NC", "/NDL", "/NFL", "/NP", "/XJ", "/R:0", "/W:0"],
    { encoding: "utf8", maxBuffer: 1 << 26, timeout: 20 * 60_000 },
  );
  const m = /Bytes\s*:\s*(\d+)/.exec(r.stdout || "");
  return m ? Number(m[1]) : null;
}

/**
 * Age of a target, as the newest of its own mtime and its profile dirs' mtimes.
 *
 * This measures when cargo last WROTE, which is not when cargo last USED: cargo
 * does not bump an artifact's mtime when it reuses it (verified read-only on this
 * tree, 2026-09-18 — build-cache.md, "Why 3, and why per shape"). So age here
 * ranks coldness; it is deliberately NOT an input to any deletion decision.
 */
function ageMsOf(dir, now) {
  let newest = null;
  const consider = (p) => {
    try {
      const m = statSync(p).mtimeMs;
      if (newest === null || m > newest) newest = m;
    } catch {
      /* gone mid-scan */
    }
  };
  consider(dir);
  for (const p of findProfileDirs(dir)) consider(p);
  return newest === null ? null : Math.max(0, now - newest);
}

// ─── discovery ──────────────────────────────────────────────────────────────

/**
 * `src-tauri/target*` directories under `checkout` that are real cargo target
 * roots. By content and by glob, not by a name list: `target-wt` and `target-wt1`
 * both exist on this machine and neither is in targets.mjs's ALTERNATE_TARGETS.
 */
function targetGlob(checkout) {
  const srcTauri = join(checkout, "src-tauri");
  let names = [];
  try {
    names = readdirSync(srcTauri, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("target"))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names.map((n) => join(srcTauri, n)).filter(isCargoTargetRoot);
}

/** Absolute paths of every live worktree, the main checkout included. */
function liveWorktrees(root) {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status !== 0) return null;
  const paths = (r.stdout || "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => norm(l.slice("worktree ".length).trim()));
  // An empty list is "could not check", not "nothing is live": git always
  // reports at least the main checkout.
  return paths.length > 0 ? paths : null;
}

/**
 * Every build cache, as rows. `discoverTargetsDetailed` is the budget's own
 * discovery and stays the base; the glob adds what it cannot see, and the
 * sccache store is appended because it is a build cache that lives outside every
 * checkout.
 */
function collectRows(root, sccacheDir) {
  const base = discoverTargetsDetailed({ root });
  const warnings = [...base.warnings];
  const rows = [];
  const seen = new Set();

  const push = (row) => {
    const key = norm(row.path).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  for (const t of base.targets) {
    push({ ...t, invisibleToBudget: false });
  }

  const wtBase = join(root, ".claude", "worktrees");
  const checkouts = [{ checkout: root, worktree: null }];
  try {
    for (const e of readdirSync(wtBase, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== ".cargo-build") {
        checkouts.push({ checkout: join(wtBase, e.name), worktree: e.name });
      }
    }
  } catch {
    /* no worktrees; base discovery already warned if it mattered */
  }

  for (const { checkout, worktree } of checkouts) {
    for (const p of targetGlob(checkout)) {
      const key = norm(p).toLowerCase();
      if (seen.has(key)) continue;
      push({
        label: worktree ? `worktree:${worktree}:src-tauri/${basename(p)}` : `alternate:src-tauri/${basename(p)}`,
        kind: worktree ? "worktree" : "alternate",
        worktree,
        path: p,
        mtime: 0,
        // The whole point of this row: the budget's discovery does not know this
        // name, so nothing counts it and nothing ever reaps it.
        invisibleToBudget: true,
      });
    }
  }

  // Listed whenever the location is KNOWN, not only when it exists. sccache
  // creates the directory on its first write, so before any wrapped build the
  // honest row is "0 bytes, not created yet" — omitting it would read as "there
  // is no such cache", which is a different fact.
  if (sccacheDir) {
    push({
      label: "sccache",
      kind: "sccache",
      worktree: null,
      path: sccacheDir,
      mtime: 0,
      exists: existsSync(sccacheDir),
      // True, and benign here: sccache enforces its own cap by LRU eviction.
      // It is the one cache on this list that does not need a reaper.
      invisibleToBudget: true,
    });
  }

  return { rows, warnings };
}

// ─── the reaper ─────────────────────────────────────────────────────────────

/**
 * Rows that are provably nobody's: a target under `.claude/worktrees/<name>/`
 * where `<name>` is not a live worktree.
 *
 * Returns `{ candidates, reasonsRejected }` and NEVER deletes. `live === null`
 * (git could not be asked) yields no candidates at all — "could not check" is
 * never "nobody's".
 */
export function reapCandidates(rows, { root, live }) {
  const rejected = [];
  if (live === null) {
    return { candidates: [], rejected: [{ path: "(all)", why: "git worktree list could not be read — nothing is provably orphaned" }] };
  }
  const wtBase = norm(join(root, ".claude", "worktrees"));
  const candidates = [];

  for (const row of rows) {
    const p = norm(row.path);
    // Only under the worktrees directory. The main checkout's targets, the
    // alternates, the sccache store and %TEMP% are out of scope by construction.
    const prefix = `${wtBase}${sep}`;
    if (!p.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const rel = p.slice(prefix.length);
    const name = rel.split(/[\\/]/)[0];
    const checkout = join(wtBase, name);
    if (live.some((w) => samePath(w, checkout))) {
      rejected.push({ path: row.path, why: `worktree ${name} is live` });
      continue;
    }
    // Belt and braces: only a directory cargo itself marked as a target root.
    if (!isCargoTargetRoot(p)) {
      rejected.push({ path: row.path, why: "not a cargo target root (CACHEDIR.TAG + .rustc_info.json) — not ours to remove" });
      continue;
    }
    if (row.bytes === null) {
      rejected.push({ path: row.path, why: "size could not be measured — an unreadable tree is not a proven one" });
      continue;
    }
    candidates.push(row);
  }
  return { candidates, rejected };
}

/**
 * Remove the candidates, re-checking each one for a live build immediately
 * before it goes — not when the list was built. `targetLiveReason` is imported
 * from cache-budget.mjs: the EBUSY `.cargo-lock` read probe plus the
 * incremental-mtime window, with that script's own fixture tests behind it.
 *
 * Takes the candidate list rather than computing it, so the only way to reach
 * this function is through `reapCandidates`, which is the rule.
 */
export function reap(candidates) {
  const reaped = [];
  const refused = [];
  for (const row of candidates) {
    const liveReason = targetLiveReason(row.path, Date.now());
    if (liveReason) {
      refused.push({ path: row.path, why: `refused at the last moment — ${liveReason}` });
      continue;
    }
    try {
      rmSync(row.path, { recursive: true, force: true });
      reaped.push({ path: row.path, bytesFreed: row.bytes ?? null });
    } catch (e) {
      refused.push({ path: row.path, why: `removal failed: ${e.message}` });
    }
  }
  return { reaped, refused };
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
const root = mainRepoRoot();
const now = Date.now();

/**
 * sccache's state, READ-ONLY. This is a report: it must not install anything and
 * must not start a server. Which matters more than it sounds — `sccache
 * --show-stats` AUTO-STARTS a server, with whatever cap the asking client's env
 * carries, so a naive reporter would quietly install a server capped at
 * sccache's 10 GiB default and then report that number as the budget. The TCP
 * probe asks without mutating; when nothing is listening, that is the answer.
 */
const sccache = await (async () => {
  const bin = findInstalled();
  if (!bin) return { ok: false, bin: null, reason: "sccache is not installed", stats: null, capEnforced: null, capWarning: null };
  if (!(await serverListening())) {
    return { ok: false, bin, reason: "sccache is installed but no server is running — stats are per-server and there are none", stats: null, capEnforced: null, capWarning: null };
  }
  const probe = serverStats(bin);
  if (!probe.ok) return { ok: false, bin, reason: `server did not answer (${probe.error})`, stats: null, capEnforced: null, capWarning: null };
  const want = parseByteSize(SCCACHE_CACHE_SIZE);
  const got = probe.stats?.maxCacheSizeBytes ?? null;
  const capEnforced = want !== null && got !== null ? got === want : null;
  return {
    ok: true,
    bin,
    reason: null,
    stats: probe.stats,
    capEnforced,
    capWarning:
      capEnforced === false
        ? `the running server caps the cache at ${probe.stats.maxCacheSize}, not the ${SCCACHE_CACHE_SIZE} budget — run \`npm run ensure:sccache -- --restart\` when no build is live`
        : capEnforced === null
          ? `the server's cap could not be read — it is NOT confirmed at ${SCCACHE_CACHE_SIZE}`
          : null,
  };
})();

const sccacheDir = (() => {
  // `Cache location` reads `Local disk: "C:\\...\\cache"` — unquote and unescape.
  const loc = sccache.stats?.cacheLocation ?? null;
  const m = loc ? /"(.+)"\s*$/.exec(loc) : null;
  if (m) return m[1].replace(/\\\\/g, "\\");
  return null;
})();

const collected = collectRows(root, sccacheDir);
const warnings = collected.warnings;
const rows = ONLY
  ? collected.rows.filter((r) => `${r.label} ${r.path}`.toLowerCase().includes(ONLY.toLowerCase()))
  : collected.rows;
if (ONLY) warnings.push(`--only ${ONLY}: ${rows.length} of ${collected.rows.length} cache(s) shown; the total below is NOT the whole disk`);

for (const row of rows) {
  row.bytes = robocopyBytes(row.path);
  row.ageMs = ageMsOf(row.path, now);
  if (flag("verify")) {
    const alt = measureDirStrict(row.path);
    row.verifyBytes = alt.ok ? alt.bytes : null;
    row.verifySkippedFiles = alt.skipped;
    row.verifyDeltaBytes = row.bytes !== null && row.verifyBytes !== null ? row.bytes - row.verifyBytes : null;
  }
}

rows.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));

const live = liveWorktrees(root);
const { candidates, rejected } = reapCandidates(rows, { root, live });

const measured = rows.filter((r) => r.bytes !== null);
const unmeasured = rows.filter((r) => r.bytes === null);
const totalBytes = measured.reduce((n, r) => n + r.bytes, 0);

let reaped = [];
if (flag("reap")) {
  const done = reap(candidates);
  reaped = done.reaped;
  rejected.push(...done.refused);
}

const result = {
  measuredAt: new Date(now).toISOString(),
  root,
  totalBytes,
  totalIsLowerBound: unmeasured.length > 0,
  budgetReference: "scripts/cache-budget.mjs holds the 60 GiB budget; this is a disk report, not a budget check",
  sccache: {
    enabled: sccache.ok,
    reason: sccache.reason,
    bin: sccache.bin,
    cacheDir: sccacheDir,
    capEnforced: sccache.capEnforced,
    capWarning: sccache.capWarning,
    maxCacheSize: sccache.stats?.maxCacheSize ?? null,
    compileRequests: sccache.stats?.compileRequests ?? null,
    cacheHits: sccache.stats?.cacheHits ?? null,
    cacheMisses: sccache.stats?.cacheMisses ?? null,
    nonCacheableCompilations: sccache.stats?.nonCacheableCompilations ?? null,
    hitRatePct: sccache.stats?.hitRatePct ?? null,
  },
  liveWorktrees: live,
  rows,
  reap: {
    rule: "delete only a target directory whose worktree no longer exists",
    acted: flag("reap"),
    candidates: candidates.map((c) => ({ path: c.path, bytes: c.bytes })),
    reaped,
    rejected,
  },
  warnings,
};

if (JSON_OUT) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

// ─── report ─────────────────────────────────────────────────────────────────

out(`build disk, ${new Date(now).toISOString()} — root ${root}`);
out("");
const w = Math.max(...rows.map((r) => r.label.length), 5, 5);
out(`${"size".padStart(12)}  ${"age".padStart(7)}  ${"cache".padEnd(w)}  path`);
for (const row of rows) {
  const marks = [];
  if (row.invisibleToBudget && row.kind !== "sccache") marks.push("NOT COUNTED BY THE BUDGET");
  if (row.kind === "sccache") {
    marks.push(`self-pruning, cap ${sccache.stats?.maxCacheSize ?? "unknown"}`);
    if (row.exists === false) marks.push("directory not created yet — 0 bytes is a fact, not a failed walk");
  }
  out(
    `${gb(row.bytes).padStart(12)}  ${ageLabel(row.ageMs).padStart(7)}  ${row.label.padEnd(w)}  ${row.path}` +
      (marks.length ? `\n${" ".repeat(12)}  ${" ".repeat(7)}  ${"".padEnd(w)}  ^ ${marks.join("; ")}` : ""),
  );
  if (flag("verify")) {
    const d = row.verifyDeltaBytes;
    out(
      `${" ".repeat(23)}  ${"".padEnd(w)}  verify(node walk): ${gb(row.verifyBytes)}` +
        (d === null ? " — one side UNMEASURED, no comparison" : ` — delta ${(d / GIB).toFixed(3)} GiB`) +
        (row.verifySkippedFiles ? `, ${row.verifySkippedFiles} file(s) unreadable mid-walk` : ""),
    );
  }
}
out("");
out(
  `total ${gb(totalBytes)} across ${measured.length} cache(s)` +
    (unmeasured.length ? ` — A LOWER BOUND: ${unmeasured.length} could not be measured` : ""),
);
for (const row of unmeasured) out(`  UNMEASURED: ${row.path}`);
for (const warning of warnings) out(`  warning: ${warning}`);

out("");
if (sccache.ok) {
  const s = sccache.stats;
  out(`sccache ${sccache.bin}`);
  out(`  cap ${s?.maxCacheSize ?? "unknown"}${sccache.capEnforced === false ? "  <-- NOT the configured budget" : ""}`);
  if (sccache.capWarning) out(`  WARNING: ${sccache.capWarning}`);
  if (s?.hitRatePct === null) {
    out(`  hit rate: NO COMPILE REQUESTS YET — 0 hits of 0; a true starting measurement, not a failure.`);
    out(`            A cache with no measured hit rate is pure cost, so re-read this after a build.`);
  } else {
    out(`  hit rate: ${s.hitRatePct}%  (${s.cacheHits} hit / ${s.cacheMisses} miss of ${s.compileRequests} requests, ${s.nonCacheableCompilations} non-cacheable)`);
    out(`            non-cacheable is expected and large: this repo's own crates build incrementally and sccache cannot cache those.`);
  }
} else {
  out(`sccache: not enabled (${sccache.reason}) — builds run unwrapped. \`npm run ensure:sccache\` provisions it.`);
}

out("");
out(`reaper — rule: ${result.reap.rule}`);
if (live === null) {
  out(`  git worktree list could not be read. NOTHING is provably orphaned, so nothing is a candidate.`);
} else {
  out(`  ${live.length} live worktree(s) (the main checkout included).`);
}
if (candidates.length === 0) {
  out(`  candidates: NONE. Every target directory belongs to a live worktree — nothing was deleted.`);
} else if (!flag("reap")) {
  out(`  candidates: ${candidates.length}, ${gb(candidates.reduce((n, c) => n + c.bytes, 0))} — report only. Re-run with --reap to delete:`);
  for (const c of candidates) out(`    ${gb(c.bytes).padStart(12)}  ${c.path}`);
} else {
  for (const r of reaped) out(`  DELETED ${gb(r.bytesFreed)}  ${r.path}`);
  if (reaped.length === 0) out(`  nothing was deleted; see the refusals below.`);
}
for (const r of rejected) out(`  kept: ${r.path} — ${r.why}`);

out("");
out(`everything else is reported, never touched. Removal commands, for the operator only:`);
for (const row of rows) {
  if (row.kind === "sccache") {
    out(`  ${row.label.padEnd(w)}  sccache --stop-server; rm -rf "${row.path}"   # or let its own cap evict`);
    continue;
  }
  if (candidates.some((c) => samePath(c.path, row.path))) continue;
  out(`  ${row.label.padEnd(w)}  rm -rf "${row.path}"`);
}
out(`  the budget's own surgical levers: npm run cache:report, npm run clean:cache, npm run clean:incremental`);
}

// Import-safe, like cache-budget.mjs: the reaper's rule is a function other code
// (and its test) can call without this file measuring 90 GiB of disk first.
const samePathSelf = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePathSelf(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  await main();
  process.exit(0);
}
