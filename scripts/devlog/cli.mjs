#!/usr/bin/env node
// npm run devlog -- <command>
//
//   sessions [--all] [--n 40]
//   digest   [--session last|<id>] [--since 24h|7d] [--walk <walk_id>] [--budget 120]
//            [--json] [--all-profiles] [--apply-ledger]
//   show     --fp <fp> [--n 5] [--session ...|--since ...|--walk ...]
//   diff     --before <walk_id|session> --after <walk_id|session> [--json]
//   ledger   list | set <fp> <status> [--sha <sha>] [--note "..."]
//   walk     [--port 17320] [--sections all|a,b]
//
// Common: --logs <dir> (default: the app's logs dir), --ledger <file>.
// Reads the logs dir READ-ONLY except `walk`, which appends to toolchain JSONL.
// Doc: docs/development/devlog.md

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadContextIndex, callsiteOf, contextOf, repoPathOf } from "./lib/context.mjs";
import { buildDigest, percentile, renderDigestText } from "./lib/digest.mjs";
import { duration, isoShort, table } from "./lib/format.mjs";
import { appendLedger, latestByFp, ledgerPath, readLedger, STATUSES } from "./lib/ledger.mjs";
import { isDevProfile, loadModel, perfKey, select } from "./lib/model.mjs";
import { REPO_ROOT, resolveLogsDir } from "./lib/paths.mjs";
import { runWalk } from "./walk.mjs";

const BOOLEAN = new Set(["json", "all", "all-profiles", "apply-ledger", "help"]);

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = a.slice(2, eq > 0 ? eq : undefined);
    if (eq > 0) out[key] = a.slice(eq + 1);
    else if (BOOLEAN.has(key)) out[key] = true;
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`--${key} needs a value`);
      out[key] = v;
      i += 1;
    }
  }
  return out;
}

class UsageError extends Error {}

const USAGE = `usage: npm run devlog -- <sessions|digest|show|diff|ledger|walk> [options]
  sessions [--all] [--n 40]
  digest   [--session last|<id>] [--since 24h|7d] [--walk <id>] [--budget 120] [--json] [--all-profiles] [--apply-ledger]
  show     --fp <fp> [--n 5] [--session <id>|--since <dur>|--walk <id>]
  diff     --before <walk|session> --after <walk|session> [--json]
  ledger   list | set <fp> <${STATUSES.join("|")}> [--sha <sha>] [--note "..."]
  walk     [--port 17320] [--sections all|a,b]
common: --logs <dir>  --ledger <file>   (doc: docs/development/devlog.md)`;

function loadBudgets() {
  try {
    return JSON.parse(fs.readFileSync(new URL("./budgets.json", import.meta.url), "utf8"));
  } catch {
    return { ipc_ms: 300, db_ms: 100, long_task_ms: 50, commit_ms: 50, span_ms: 200, boot_phase_ms: 1000, commands: {} };
  }
}

function selectionOpts(args) {
  return { session: args.session, since: args.since, walk: args.walk, allProfiles: Boolean(args["all-profiles"]) };
}

// ── commands ────────────────────────────────────────────────────────────────

async function cmdSessions(args, io) {
  const model = await loadModel(io.logsDir);
  const all = Boolean(args.all);
  const joined = new Map();
  for (const s of model.sessions.values()) if (s.devlogSession) joined.set(s.devlogSession, [...(joined.get(s.devlogSession) ?? []), s.id]);
  const list = [...model.sessions.values()]
    .filter((s) => s.kind === "toolchain" || all || isDevProfile(s))
    .sort((a, b) => b.start - a.start);
  const n = Number(args.n ?? 40);
  const rows = list.slice(0, n).map((s) => ({
    id: s.id,
    kind: s.kind === "toolchain" ? (s.script ?? "toolchain") : s.kind,
    start: isoShort(s.start),
    dur: duration(s.last - s.start),
    profile: s.profile ?? "-",
    ERROR: s.counts.ERROR ?? 0,
    WARN: s.counts.WARN ?? 0,
    INFO: s.counts.INFO ?? 0,
    DEBUG: s.counts.DEBUG ?? 0,
    joined: s.devlogSession ?? (joined.get(s.id) ?? []).join(",") ?? "-",
  }));
  if (args.json) return io.out(JSON.stringify({ logs_dir: io.logsDir, sessions: rows }, null, 2) + "\n");
  const lines = [`devlog sessions | ${io.logsDir} | ${list.length} sessions${all ? "" : " (release boots hidden; --all shows them)"}`];
  lines.push(...table(["id", "kind", "start", "dur", "profile", "ERROR", "WARN", "INFO", "DEBUG", "joined"], rows));
  if (list.length > n) lines.push(`(+${list.length - n} older; --n to show more)`);
  io.out(lines.join("\n") + "\n");
}

async function cmdDigest(args, io) {
  const t0 = performance.now();
  const model = await loadModel(io.logsDir);
  const sel = select(model, selectionOpts(args));
  const ledgerFile = ledgerPath(args.ledger);
  const entries = readLedger(ledgerFile);
  const budget = Number(args.budget ?? 120);
  if (!Number.isFinite(budget) || budget < 1) throw new UsageError("--budget must be a positive number");
  const d = buildDigest(model, sel, {
    budgets: loadBudgets(),
    budget,
    ledgerEntries: entries,
    latestLedger: latestByFp(entries),
    contextIndex: loadContextIndex(),
    lastBootPath: path.join(io.logsDir, "last_boot.log"),
    allProfiles: Boolean(args["all-profiles"]),
  });
  if (args["apply-ledger"]) {
    for (const tr of d.transitions) appendLedger(ledgerFile, { fp: tr.fp, status: tr.to, note: `derived: ${tr.from} -> ${tr.to} (session ${tr.session})` });
  }
  const elapsedMs = Math.round(performance.now() - t0);
  if (args.json) io.out(JSON.stringify({ ...d, meta: { ...d.meta, elapsed_ms: elapsedMs } }, null, 2) + "\n");
  else io.out(renderDigestText(d, { elapsedMs }));
}

function matchesFp(r, fp) {
  if (r.fp === fp) return true;
  const pk = perfKey(r);
  return Boolean(pk && pk.fp === fp);
}

function summarizeField(values) {
  const nums = values.filter((v) => typeof v === "number");
  const counts = new Map();
  for (const v of values) {
    const k = typeof v === "object" ? JSON.stringify(v) : String(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([v, n]) => `${v.length > 60 ? v.slice(0, 57) + "..." : v} x${n}`);
  const range = nums.length === values.length && nums.length > 1 ? ` | min ${Math.min(...nums)} p50 ${percentile(nums, 50)} p95 ${percentile(nums, 95)} max ${Math.max(...nums)}` : "";
  return `${counts.size} distinct: ${top.join(", ")}${range}`;
}

async function cmdShow(args, io) {
  const fp = args.fp ?? args._[1];
  if (!fp) throw new UsageError("show needs --fp <fp>");
  const model = await loadModel(io.logsDir);
  const scoped = args.session || args.since || args.walk ? select(model, selectionOpts(args)).records : model.records;
  const hits = scoped.filter((r) => matchesFp(r, fp));
  if (!hits.length) return io.out(`fp ${fp}: no records${args.session || args.since || args.walk ? " in this selection" : ""}\n`);
  const first = hits[0];
  const last = hits.at(-1);
  const lines = [
    `fp ${fp} | count ${hits.length} | first ${first.ts} | last ${last.ts}`,
    `lvl ${first.lvl} | src ${first.src} | tgt ${first.tgt} | callsite ${callsiteOf(first)} | context ${contextOf(loadContextIndex(), repoPathOf(first))}`,
    `msg: ${first.msg ?? ""}`,
  ];
  const fields = new Map();
  for (const r of hits) for (const [k, v] of Object.entries(r.f ?? {})) {
    if (k === "detail" || k === "stack") continue;
    if (!fields.has(k)) fields.set(k, []);
    fields.get(k).push(v);
  }
  if (fields.size) {
    lines.push("fields:");
    for (const [k, vs] of fields) lines.push(`  ${k}: ${summarizeField(vs)}`);
  }
  const bySession = new Map();
  for (const r of hits) bySession.set(r.boot ?? "unknown", (bySession.get(r.boot ?? "unknown") ?? 0) + 1);
  lines.push(`sessions (${bySession.size}): ${[...bySession.entries()].slice(-5).map(([s, n]) => `${s} x${n}`).join(", ")}`);
  const n = Number(args.n ?? 5);
  lines.push(`samples (last ${Math.min(n, hits.length)}):`);
  for (const r of hits.slice(-n)) {
    const clean = {};
    for (const [k, v] of Object.entries(r)) if (!k.startsWith("_")) clean[k] = v;
    lines.push(JSON.stringify(clean));
  }
  io.out(lines.join("\n") + "\n");
}

function aggregateForDiff(records) {
  const out = new Map();
  const bump = (key, label, value) => {
    let a = out.get(key);
    if (!a) out.set(key, (a = { key, label, count: 0, durations: [] }));
    a.count += 1;
    if (Number.isFinite(value)) a.durations.push(value);
  };
  for (const r of records) {
    const pk = perfKey(r);
    if (pk) {
      const d = Number(r.f?.duration_ms ?? r.f?.p95_ms ?? r.f?.busy_ms);
      bump(pk.fp, `${pk.section} ${pk.key}`, d);
    } else if (r.lvl === "WARN" || r.lvl === "ERROR") bump(r.fp, `${r.lvl.toLowerCase()} ${r.msg ?? ""}`.slice(0, 70));
  }
  return out;
}

function resolveForDiff(model, id) {
  try {
    return select(model, { walk: id });
  } catch {
    return select(model, { session: id });
  }
}

async function cmdDiff(args, io) {
  if (!args.before || !args.after) throw new UsageError("diff needs --before and --after");
  const model = await loadModel(io.logsDir);
  const before = aggregateForDiff(resolveForDiff(model, args.before).records);
  const after = aggregateForDiff(resolveForDiff(model, args.after).records);
  const rows = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    const bp = b ? percentile(b.durations, 95) : undefined;
    const ap = a ? percentile(a.durations, 95) : undefined;
    let verdict;
    if (!b) verdict = "new";
    else if (!a) verdict = "gone";
    else if (bp !== undefined && ap !== undefined) verdict = ap < bp * 0.9 ? "improved" : ap > bp * 1.1 ? "regressed" : "same";
    else verdict = a.count < b.count ? "improved" : a.count > b.count ? "regressed" : "same";
    rows.push({ fp: key, verdict, before: b?.count ?? 0, after: a?.count ?? 0, p95_before: bp ?? "-", p95_after: ap ?? "-", what: (a ?? b).label });
  }
  const rank = { regressed: 0, new: 1, improved: 2, gone: 3, same: 4 };
  rows.sort((x, y) => rank[x.verdict] - rank[y.verdict] || y.after + y.before - (x.after + x.before));
  if (args.json) return io.out(JSON.stringify({ before: args.before, after: args.after, rows }, null, 2) + "\n");
  const lines = [`devlog diff | before ${args.before} | after ${args.after} | ${rows.length} keys`];
  lines.push(...table(["fp", "verdict", "before", "after", "p95_before", "p95_after", "what"], rows));
  io.out(lines.join("\n") + "\n");
}

async function cmdLedger(args, io) {
  const file = ledgerPath(args.ledger);
  const sub = args._[1] ?? "list";
  if (sub === "set") {
    const [fp, status] = [args._[2], args._[3]];
    if (!fp || !status) throw new UsageError("ledger set <fp> <status> [--sha <sha>] [--note ...]");
    try {
      const e = appendLedger(file, { fp, status, sha: args.sha, note: args.note });
      return io.out(`ledger: ${e.fp} -> ${e.status}${e.sha ? ` @${e.sha}` : ""}\n`);
    } catch (err) {
      throw new UsageError(err.message);
    }
  }
  if (sub !== "list") throw new UsageError(`ledger ${sub}: use list | set`);
  const entries = readLedger(file);
  const latest = latestByFp(entries);
  const history = new Map();
  for (const e of entries) history.set(e.fp, (history.get(e.fp) ?? 0) + 1);
  const rows = [...latest.values()]
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .map((e) => ({ fp: e.fp, status: e.status, sha: e.sha, ts: e.ts.slice(0, 19) + "Z", changes: history.get(e.fp), note: e.note }));
  if (args.json) return io.out(JSON.stringify({ ledger: file, rows }, null, 2) + "\n");
  const lines = [`devlog ledger | ${path.relative(REPO_ROOT, file) || file} | ${rows.length} fps, ${entries.length} entries`];
  lines.push(...(rows.length ? table(["fp", "status", "sha", "ts", "changes", "note"], rows) : ["(empty)"]));
  io.out(lines.join("\n") + "\n");
}

async function cmdWalk(args, io) {
  const port = Number(args.port || process.env.PERSONAS_TEST_PORT || 17320);
  const { exitCode } = await runWalk({ port, sections: args.sections, logsDir: io.logsDir, print: (l) => io.out(l + "\n") });
  return exitCode;
}

const COMMANDS = { sessions: cmdSessions, digest: cmdDigest, show: cmdShow, diff: cmdDiff, ledger: cmdLedger, walk: cmdWalk };

/** Entry point; returns the exit code. `io` lets tests capture output. */
export async function main(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s));
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  const name = args._[0];
  if (!name || args.help || !COMMANDS[name]) {
    (name && !args.help ? err : out)(`${name && !COMMANDS[name] ? `unknown command "${name}"\n` : ""}${USAGE}\n`);
    return name && !args.help ? 2 : 0;
  }
  const logsDir = resolveLogsDir(args.logs);
  try {
    const code = await COMMANDS[name](args, { out, err, logsDir });
    return typeof code === "number" ? code : 0;
  } catch (e) {
    err(`devlog ${name}: ${e.message}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
