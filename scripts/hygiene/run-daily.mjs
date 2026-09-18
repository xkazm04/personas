#!/usr/bin/env node
// Daily build hygiene — the unattended entry point.
//
//   npm run hygiene:run                 # do it now
//   npm run hygiene:run -- --dry-run    # print what it would do, delete nothing
//   npm run hygiene:log                 # last 20 evictions + bytes freed in 30 days
//   npm run hygiene:log -- 100          # last 100
//   npm run hygiene:install             # register the daily Windows task (install-task.mjs)
//
// WHY A SCHEDULED TASK AND NOT ONLY THE BUILD GUARD
// -------------------------------------------------
// The predev/prebuild guard (scripts/cache-budget.mjs) enforces the budget, but
// only when somebody runs `npm run dev`/`build`, and it hands the work to a
// background process that stands down the moment cargo takes its lock — which,
// for `tauri dev`, is seconds later. Agents that call cargo directly never pass
// through the guard at all. Measured 2026-09-18: 88.3 GiB against the budget,
// zero bytes ever evicted automatically. A budget needs a lever that fires
// whether or not anyone is looking; this is it.
//
// WHAT ONE RUN DOES, in order
//   1. cargo targets in %TEMP% whose newest file is older than 24 h and that no
//      running process names — temp-gc.mjs's predicate, imported, not copied.
//      FIRST, so the enforcer's discovery walks (and counts) only what survived.
//      The %TEMP% walk is capped at 50,000 dirs; hitting the cap prints one line
//      — a capped walk is "could not check", never "clean".
//   2. budget enforcement over EVERY discovered target (trigger "daily") —
//      same engine, same eviction order as `npm run clean:cache`, minus the
//      manual-only "drop a whole worktree target" stage.
//   3. worktree GC with worktree-gc.mjs's EXISTING predicate only: clean +
//      merged + older than 14 d. Plus zero-byte orphan SHELLS: a directory under
//      .claude/worktrees/ that git does not list AND that is completely empty.
//      An orphan with ANY content is reported and never removed.
//   4. root residue: build-*.log, *.stackdump, response*.txt at the repo root,
//      older than 14 d and NOT tracked by git (verified per file).
//
// WHAT IT REFUSES
//   - anything inside a target whose cargo lock is held or whose incremental
//     cache was written in the last 90 s (see cache-budget.mjs); a worktree whose
//     target is live is not removed; root residue is left alone while the main
//     target is building (a build-*.log may be that build's).
//   - temp targets when running processes could not be listed.
//   - any file git tracks, and any file whose tracked-ness could not be checked.
// Every refusal prints its reason. Every deletion is one line on stderr and one
// row in ~/.personas/build-hygiene.jsonl (scripts/hygiene/log.mjs).
//
// Exit code: 0 done (including "refused, build live"); 2 when something could
// not be measured — Task Scheduler's "Last Run Result" then shows it.

import { execFileSync } from "node:child_process";
import { readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enforceBudget, mainRepoRoot, targetLiveReason, measureDirStrict } from "../cache-budget.mjs";
import { discoverTempTargets, discoverTargetsDetailed } from "./targets.mjs";
import { recordEviction, readLog, summarize, formatBytes, logPath } from "./log.mjs";
import { runningCommandLines, tempEntryVerdict, DEFAULT_GRACE_H } from "../temp-gc.mjs";
import { collectWorktreeRows, removeWorktreeRows, DEFAULT_DAYS } from "../worktree-gc.mjs";

const DAY_MS = 86_400_000;
export const RESIDUE_PATTERNS = [/^build-.*\.log$/i, /\.stackdump$/i, /^response.*\.txt$/i];
export const RESIDUE_MAX_AGE_DAYS = 14;

const stderrPrint = (l) => process.stderr.write(l + "\n");

function mkRecord({ trigger, dryRun, logPath: lp, print, now }) {
  return (row) => {
    if (dryRun) {
      print(`[hygiene] would evict ${row.category} ${formatBytes(row.bytesFreed)} from ${row.target} — ${row.reason}`);
      return { trigger, ...row, dryRun: true };
    }
    return recordEviction({ trigger, ...row }, { path: lp, print, now });
  };
}

/** 1. Stale cargo targets in %TEMP%. `procText` null => refuse all (could not check). */
export function sweepTempTargets(targets, opts = {}) {
  const { now = Date.now(), graceMs = DEFAULT_GRACE_H * 3600e3, dryRun = false, print = stderrPrint } = opts;
  const record = mkRecord({ trigger: opts.trigger ?? "daily", dryRun, logPath: opts.logPath, print, now: opts.now });
  const out = { removed: [], refused: [] };
  const temp = targets.filter((t) => t.kind === "temp");
  if (temp.length === 0) return out;
  const procText = "procText" in opts ? opts.procText : runningCommandLines();
  for (const t of temp) {
    const v = tempEntryVerdict(t.path, { now, graceMs, procText });
    if (!v.eligible) {
      const why = v.reason === "fresh" ? `newest file written inside the ${Math.round(graceMs / 3600e3)} h grace window`
        : v.reason === "in-use" ? "named on a running process's command line"
        : "running processes could not be listed — in-use check impossible";
      out.refused.push({ target: t.label, reason: why });
      if (v.reason !== "fresh") print(`[hygiene] refused ${t.label} — ${why}`);
      continue;
    }
    const live = targetLiveReason(t.path, Date.now());
    if (live) {
      out.refused.push({ target: t.label, reason: live });
      print(`[hygiene] refused ${t.label} — ${live}`);
      continue;
    }
    if (!dryRun) {
      try {
        rmSync(t.path, { recursive: true, force: true, maxRetries: 2 });
      } catch (e) {
        out.refused.push({ target: t.label, reason: `could not remove: ${e.message}` });
        continue;
      }
    }
    out.removed.push(record({
      target: t.path, category: "temp-target", bytesFreed: v.bytes,
      reason: `cargo target in the temp dir, newest file ${Math.floor((now - v.newest) / DAY_MS)} d old (> ${Math.round(graceMs / 3600e3)} h), named by no running process`,
    }));
  }
  return out;
}

/** 3. Worktree GC (existing predicate) + empty orphan shells. */
export function sweepWorktrees(root, opts = {}) {
  const { now = Date.now(), dryRun = false, print = stderrPrint, days = DEFAULT_DAYS } = opts;
  const record = mkRecord({ trigger: opts.trigger ?? "daily", dryRun, logPath: opts.logPath, print, now: opts.now });
  const out = { removed: [], refused: [], reportedOrphans: [] };
  // includeOrphans stays FALSE: the GC's own orphan removal is recursive and is
  // a human's call (`--include-orphans`). Orphans are handled below, empty only.
  const { rows } = collectWorktreeRows({ root, days, includeOrphans: false, now, measure: false });

  const removable = [];
  for (const r of rows) {
    if (r.kind === "orphan" || !r.removable) continue;
    if (r.kind === "worktree") {
      const live = targetLiveReason(join(r.path, "src-tauri", "target"), Date.now());
      if (live) {
        out.refused.push({ target: `worktree:${r.name}`, reason: live });
        print(`[hygiene] refused worktree:${r.name} — ${live}`);
        continue;
      }
      const m = measureDirStrict(r.path);
      r.size = m.ok ? m.bytes : 0;
    }
    removable.push(r);
  }
  if (dryRun) {
    for (const r of removable) if (r.kind === "worktree") out.removed.push(record({ target: `worktree:${r.name}`, category: "worktree-target", bytesFreed: r.size, reason: `worktree is ${r.note} (> ${days} d): whole working dir + target` }));
  } else if (removable.length) {
    removeWorktreeRows(root, removable, {
      onRemoved: (r) => {
        if (r.kind !== "worktree") return; // a pruned stale ref freed nothing
        out.removed.push(record({
          target: `worktree:${r.name}`, category: "worktree-target", bytesFreed: r.size,
          reason: `worktree is ${r.note} (> ${days} d): whole working dir + target removed; branch and commits kept`,
        }));
      },
      onFailed: (r, e) => {
        out.refused.push({ target: `worktree:${r.name}`, reason: `git worktree remove failed: ${String(e.message).split("\n")[0]}` });
        print(`[hygiene] refused worktree:${r.name} — removal failed: ${String(e.message).split("\n")[0]}`);
      },
    });
  }

  for (const r of rows.filter((x) => x.kind === "orphan")) {
    let entries;
    try {
      entries = readdirSync(r.path);
    } catch (e) {
      out.reportedOrphans.push({ name: r.name, reason: `could not be listed (${e.code})` });
      print(`[hygiene] orphan ${r.name} could not be listed (${e.code}) — left alone`);
      continue;
    }
    if (entries.length > 0) {
      out.reportedOrphans.push({ name: r.name, reason: `${entries.length} top-level entr${entries.length === 1 ? "y" : "ies"}` });
      print(`[hygiene] orphan worktree dir ${r.name} is not tracked by git and HAS CONTENT (${entries.length} entries) — reported, never removed automatically. Inspect, then: node scripts/worktree-gc.mjs --include-orphans`);
      continue;
    }
    if (!dryRun) {
      try {
        rmdirSync(r.path); // non-recursive on purpose: fails if anything appeared since the listing
      } catch (e) {
        out.reportedOrphans.push({ name: r.name, reason: `rmdir failed (${e.code})` });
        continue;
      }
    }
    out.removed.push(record({
      target: `worktree:${r.name}`, category: "worktree-orphan", bytesFreed: 0,
      reason: "empty directory under .claude/worktrees/ that git worktree list does not know",
    }));
  }
  return out;
}

function gitStatus(root, args) {
  try {
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
    return 0;
  } catch (e) {
    return typeof e.status === "number" ? e.status : null;
  }
}

/** 4. Root residue — old, pattern-matched and verified NOT tracked. */
export function sweepRootResidue(root, opts = {}) {
  const { now = Date.now(), dryRun = false, print = stderrPrint, maxAgeDays = RESIDUE_MAX_AGE_DAYS } = opts;
  const record = mkRecord({ trigger: opts.trigger ?? "daily", dryRun, logPath: opts.logPath, print, now: opts.now });
  const out = { removed: [], refused: [] };
  let names;
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch (e) {
    out.refused.push({ target: root, reason: `repo root could not be listed (${e.code})` });
    return out;
  }
  for (const name of names) {
    if (!RESIDUE_PATTERNS.some((re) => re.test(name))) continue;
    const full = join(root, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    const ageDays = (now - st.mtimeMs) / DAY_MS;
    if (ageDays <= maxAgeDays) continue;
    // `ls-files --error-unmatch`: 0 = tracked, 1 = not tracked. Anything else
    // (128 = not a repo, null = git did not run) is "could not check" -> keep.
    const tracked = gitStatus(root, ["ls-files", "--error-unmatch", "--", name]);
    if (tracked === 0) {
      out.refused.push({ target: name, reason: "tracked by git" });
      continue;
    }
    if (tracked !== 1) {
      out.refused.push({ target: name, reason: `could not verify it is untracked (git exit ${tracked})` });
      print(`[hygiene] refused ${name} — could not verify it is untracked (git exit ${tracked})`);
      continue;
    }
    const ignored = gitStatus(root, ["check-ignore", "-q", "--", name]) === 0;
    if (!dryRun) {
      try { rmSync(full, { force: true }); } catch (e) {
        out.refused.push({ target: name, reason: `could not remove: ${e.message}` });
        continue;
      }
    }
    out.removed.push(record({
      target: name, category: "root-residue", bytesFreed: st.size,
      reason: `repo-root residue, ${Math.floor(ageDays)} d old (> ${maxAgeDays} d), ${ignored ? "git-ignored" : "untracked"}`,
    }));
  }
  return out;
}

/** One full run. Everything destructive is reachable only through here or the exports above. */
export function runDaily(opts = {}) {
  const root = opts.root ?? mainRepoRoot();
  const tmpdir = opts.tmpdir ?? (process.env.CACHE_BUDGET_TMPDIR || osTmpdir());
  const print = opts.print ?? stderrPrint;
  const common = { trigger: "daily", dryRun: !!opts.dryRun, logPath: opts.logPath, print, now: opts.now };

  print(`[hygiene] daily run${opts.dryRun ? " (DRY RUN)" : ""} — root ${root}`);
  // Temp sweep FIRST (its own bounded temp-only walk), so the enforcer's
  // discovery below sees — and budgets — only the temp targets that survived.
  const tempWalk = discoverTempTargets(tmpdir, opts.maxTempDirs ? { maxDirs: opts.maxTempDirs } : undefined);
  for (const w of tempWalk.warnings) print(`[hygiene] WARNING: ${w}`);
  const tempTargets = tempWalk.targets.map((p) => ({ label: `temp:${p.slice(tmpdir.length + 1).split("\\").join("/")}`, kind: "temp", path: p }));
  const temp = sweepTempTargets(tempTargets, { ...common, ...("procText" in opts ? { procText: opts.procText } : {}) });

  const budget = enforceBudget(root, { ...common, tmpdir, budgetBytes: opts.budgetBytes, measure: opts.measure, hasCargoSweep: opts.hasCargoSweep, runCargoSweep: opts.runCargoSweep });
  const warnings = tempWalk.warnings;
  const worktrees = sweepWorktrees(root, common);

  const mainLive = targetLiveReason(join(root, "src-tauri", "target"), Date.now());
  let residue;
  if (mainLive) {
    residue = { removed: [], refused: [{ target: "root-residue", reason: mainLive }] };
    print(`[hygiene] refused root-residue sweep — main target: ${mainLive}`);
  } else {
    residue = sweepRootResidue(root, common);
  }

  const freed = budget.freedBytes
    + [...temp.removed, ...worktrees.removed, ...residue.removed].reduce((s, r) => s + (r.bytesFreed || 0), 0);
  for (const n of budget.notes.filter((x) => !warnings.includes(x))) print(`[hygiene] note: ${n}`);
  if (budget.status === "unmeasured") {
    print(`[hygiene] COULD NOT MEASURE: ${budget.unmeasured.map((u) => `${u.label} (${u.error})`).join("; ")} — footprint is AT LEAST ${formatBytes(budget.totalBytes)}; NOT reported as under budget`);
  } else {
    print(`[hygiene] footprint ${formatBytes(budget.totalBytes)} / ${formatBytes(budget.budgetBytes)} budget — ${budget.status}`);
  }
  print(`[hygiene] ${opts.dryRun ? "would free" : "freed"} ${formatBytes(freed)} this run`);
  return { root, budget, temp, worktrees, residue, freedBytes: freed, exitCode: budget.status === "unmeasured" ? 2 : 0 };
}

export function printLog(n = 20, { path = logPath(), out = process.stdout, now = Date.now() } = {}) {
  const { rows, corrupt, missing } = readLog(path);
  out.write(`Build hygiene log — ${path}\n`);
  if (missing) {
    out.write("  (no log yet — nothing has ever been evicted, or the log path is wrong)\n");
    return;
  }
  for (const r of rows.slice(-n)) {
    out.write(`  ${r.ts}  ${String(r.trigger).padEnd(6)} ${String(r.category).padEnd(16)} ${formatBytes(r.bytesFreed || 0).padStart(10)}  ${r.target}\n      ${r.reason}\n`);
  }
  const s = summarize(rows, { days: 30, now });
  out.write(`\n  last 30 days: ${s.count} eviction(s), ${formatBytes(s.bytes)} freed\n`);
  for (const [cat, b] of Object.entries(s.byCategory).sort((a, b2) => b2[1] - a[1])) {
    out.write(`    ${cat.padEnd(16)} ${formatBytes(b).padStart(10)}\n`);
  }
  if (corrupt) out.write(`  ! ${corrupt} unparseable line(s) skipped\n`);
}

const SELF = fileURLToPath(import.meta.url);
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePath(resolve(process.argv[1]), SELF)) {
  const args = process.argv.slice(2);
  if (args.includes("--log")) {
    const n = Number(args.find((a) => /^\d+$/.test(a))) || 20;
    printLog(n);
    process.exit(0);
  }
  // An unattended run that discovers no cargo target at all looked at nothing; the scheduled
  // task must go red rather than log a clean day (wrong root, broken walk, moved checkout).
  const seen = discoverTargetsDetailed({ root: mainRepoRoot(), tmpdir: process.env.CACHE_BUDGET_TMPDIR || osTmpdir() }).targets;
  if (seen.length === 0) {
    process.stderr.write("[hygiene] no cargo target discovered - nothing was checked\n");
    process.exit(1);
  }
  try {
    const r = runDaily({ dryRun: args.includes("--dry-run") });
    process.exit(r.exitCode);
  } catch (e) {
    process.stderr.write(`[hygiene] daily run FAILED: ${e.stack || e.message}\n`);
    process.exit(1);
  }
}
