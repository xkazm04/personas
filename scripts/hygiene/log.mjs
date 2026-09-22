// The eviction log: one JSONL row per thing build hygiene deleted.
//
//   ~/.personas/build-hygiene.jsonl        (override: PERSONAS_HYGIENE_LOG)
//
// WHY A LOG AT ALL
// ----------------
// The reaper now deletes without asking — from the predev/prebuild guard and
// from a scheduled task nobody watches. Self-healing that leaves no trace is
// indistinguishable from a cache that mysteriously keeps going cold, and the
// first response to that is to switch the reaper off. So every eviction is
// recorded with what, how many bytes and WHY, and also printed as one line at
// the moment it happens. `npm run hygiene:log` reads this file back.
//
// It lives in the home directory, not the repo: the same log must be written
// from the main checkout, from any worktree and from the scheduled task, and it
// must survive `git clean`.
//
// A failed append is reported on stderr and never throws: losing a log row must
// not abort a prune half-way, and must not fail a build.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CATEGORIES = [
  "deps-superseded", "incremental", "cargo-sweep", "build-orphan",
  "worktree-target", "temp-target", "worktree-orphan", "root-residue",
];
export const TRIGGERS = ["guard", "daily", "manual"];

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export function formatBytes(bytes) {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GB`;
  if (bytes >= MIB / 10) return `${(bytes / MIB).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function logPath() {
  return process.env.PERSONAS_HYGIENE_LOG || join(homedir(), ".personas", "build-hygiene.jsonl");
}

/**
 * Record one eviction and print its one line.
 * @param {{trigger:string, target:string, category:string, bytesFreed:number, reason:string}} row
 * @param {{path?:string, print?:(line:string)=>void, now?:number}} [opts]
 */
export function recordEviction(row, opts = {}) {
  if (!CATEGORIES.includes(row.category)) throw new Error(`hygiene log: unknown category "${row.category}"`);
  if (!TRIGGERS.includes(row.trigger)) throw new Error(`hygiene log: unknown trigger "${row.trigger}"`);
  const full = {
    ts: new Date(opts.now ?? Date.now()).toISOString(),
    trigger: row.trigger,
    target: row.target,
    category: row.category,
    bytesFreed: Math.max(0, Math.round(row.bytesFreed || 0)),
    reason: row.reason,
  };
  const print = opts.print ?? ((l) => process.stderr.write(l + "\n"));
  print(`[hygiene] evicted ${full.category} ${formatBytes(full.bytesFreed)} from ${full.target} — ${full.reason}`);
  const path = opts.path ?? logPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(full) + "\n");
  } catch (e) {
    process.stderr.write(`[hygiene] COULD NOT WRITE eviction log ${path}: ${e.message}\n`);
  }
  return full;
}

/** All parseable rows. A missing file is an empty log; a corrupt line is skipped and counted. */
export function readLog(path = logPath()) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { rows: [], corrupt: 0, missing: true };
    throw e;
  }
  const rows = [];
  let corrupt = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      corrupt++;
    }
  }
  return { rows, corrupt, missing: false };
}

/** Bytes freed in the last `days`, overall and per category. */
export function summarize(rows, { days = 30, now = Date.now() } = {}) {
  const since = now - days * 86_400_000;
  const byCategory = {};
  let bytes = 0;
  let count = 0;
  for (const r of rows) {
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t) || t < since) continue;
    bytes += r.bytesFreed || 0;
    count++;
    byCategory[r.category] = (byCategory[r.category] || 0) + (r.bytesFreed || 0);
  }
  return { days, count, bytes, byCategory };
}
