// The ranked digest: what a session (or a window, or a walk) produced, in the
// order a fixer should read it. Every section is computed from the selection
// alone, except "New since previous session" and the ledger re-judgement,
// which compare against other sessions in the same logs dir.
//
// Cost (the rank inside a section):
//   error = 1000 + count            (count includes rate-limited suppressions)
//   warn  = count * (1 + suppressed / (count + suppressed))
//   perf  = sum(max(0, duration - budget)) ms

import fs from "node:fs";
import { callsiteOf, contextOf, repoPathOf } from "./context.mjs";
import { cut, isoShort, num, sampleOf, table } from "./format.mjs";
import { fnv1a32 } from "../fingerprint.mjs";
import { deriveTransitions } from "./ledger.mjs";
import { appSessions, fpsBySession, perfKey, previousSession } from "./model.mjs";

export const SECTION_ORDER = [
  "Coverage",
  "Boot phases",
  "Errors",
  "Repeating warnings",
  "Slow IPC",
  "Slow DB",
  "Render",
  "Rust spans",
  "Toolchain",
  "New since previous session",
  "Ledger",
];

const BASE = ["fp", "count", "cost"];
const TAIL = ["msg", "callsite", "context"];

export function percentile(values, p) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function excess(values, budget) {
  let total = 0;
  for (const v of values) if (v > budget) total += v - budget;
  return total;
}

function groupBy(records, keyOf) {
  const out = new Map();
  for (const r of records) {
    const k = keyOf(r);
    if (k === undefined || k === null) continue;
    let g = out.get(k);
    if (!g) out.set(k, (g = []));
    g.push(r);
  }
  return out;
}

const byCost = (a, b) => b._cost - a._cost || (b.count ?? 0) - (a.count ?? 0);

function where(ctx, rec) {
  return { callsite: callsiteOf(rec), context: contextOf(ctx.contextIndex, repoPathOf(rec)) };
}

// ── sections ────────────────────────────────────────────────────────────────

// [producer, record test, the source it rides on]. A producer with no records
// is only `NOT CAPTURED` when its SOURCE is dark too: an error kind with zero
// errors while the WebView is reporting means "nothing happened", and saying
// "nobody looked" there is the false alarm that teaches readers to ignore it.
const PRODUCERS = [
  ["rust", (r) => r.src === "rust", "rust"],
  ["span timings", (r) => r.msg === "span.close", "rust"],
  ["webview error", (r) => r.tgt === "webview::error", "webview"],
  ["ipc_slow", (r) => r.tgt === "webview::ipc_slow", "webview"],
  ["ipc_window", (r) => r.tgt === "webview::ipc_window", "webview"],
  ["long_task", (r) => r.tgt === "webview::long_task", "webview"],
  ["commit", (r) => r.tgt === "webview::commit", "webview"],
  ["freeze/store_alert", (r) => r.tgt === "webview::freeze" || r.tgt === "webview::store_alert", "webview"],
  ["swallow_rollup", (r) => r.tgt === "webview::swallow_rollup", "webview"],
  ["toolchain cargo", (r) => r.src === "toolchain" && r.tgt === "cargo", "toolchain"],
  ["toolchain vite", (r) => r.src === "toolchain" && r.tgt === "vite", "toolchain"],
  ["toolchain tauri", (r) => r.src === "toolchain" && r.tgt === "tauri", "toolchain"],
  ["db slow query", (r) => r.msg === "Slow DB query detected", "rust"],
];

/** Which sources were reporting in this selection. The toolchain counts as
 *  live when the focused app boot was started by the dev wrapper (its
 *  boot.start names a devlog session) or a wrapper session record is in view;
 *  a walk's own records do not make it live. */
function liveSources(records, focus) {
  const live = new Set();
  for (const r of records) {
    if (r.src === "rust" || r.src === "webview") live.add(r.src);
    else if (r.src === "toolchain" && !String(r.boot ?? "").startsWith("walk-")) live.add("toolchain");
  }
  if (focus?.devlogSession) live.add("toolchain");
  return live;
}

function coverage(records, focus) {
  const live = liveSources(records, focus);
  const rows = PRODUCERS.map(([producer, test, sourceName]) => {
    let count = 0;
    let legacy = 0;
    for (const r of records) {
      if (!test(r)) continue;
      count += 1;
      if (r._legacy) legacy += 1;
    }
    const source = count === 0 ? "-" : legacy === count ? "legacy-text" : legacy ? "jsonl+legacy-text" : "jsonl";
    const shown = count ? count : live.has(sourceName) ? `0 (${sourceName} live)` : "NOT CAPTURED";
    return { producer, count: shown, source };
  });
  return { columns: ["producer", "count", "source"], rows, fixed: true };
}

const TABLE_MARK = "=== Startup Timing ===";

export function parseStartupTable(text) {
  if (!text || !text.includes(TABLE_MARK)) return null;
  const total = /Total setup: (\d+)ms/.exec(text);
  const phases = [];
  for (const m of text.matchAll(/^\s*([A-Za-z0-9_.-]+)\s+(\d+)ms\s+\(at (\d+)ms\)/gm)) {
    phases.push({ name: m[1], ms: Number(m[2]), at: Number(m[3]) });
  }
  return { total: total ? Number(total[1]) : undefined, phases };
}

function tableTextOf(r) {
  const parts = [r.msg ?? ""];
  for (const v of Object.values(r.f ?? {})) if (typeof v === "string") parts.push(v);
  const text = parts.join("\n");
  return text.includes(TABLE_MARK) ? text : null;
}

export function readLastBoot(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    const t = /^Time: (\S+)/m.exec(text);
    const stamp = t ? Date.parse(t[1].replace(/(\.\d{3})\d+/, "$1")) : NaN;
    const table = parseStartupTable(text);
    return table ? { ...table, start: stamp } : null;
  } catch {
    return null;
  }
}

/**
 * Boot phases: one row for the setup total and one per startup phase,
 * aggregated over every boot in the selection that logged its timing table
 * (`boots` = how many did). Phases under 100 ms at their worst are dropped.
 */
function bootPhases(ctx, sel) {
  const ids = new Set();
  for (const r of sel.records) if (r.src !== "toolchain") ids.add(r.boot ?? "unknown");
  const tables = [];
  let boots = 0;
  let latest = null;
  for (const id of ids) {
    const s = ctx.model.sessions.get(id);
    if (!s || (s.kind !== "boot" && s.kind !== "legacy")) continue;
    boots += 1;
    const rec = ctx.tables.get(id);
    const table = rec ? parseStartupTable(tableTextOf(rec)) : null;
    if (!table) continue;
    const entry = { id, start: s.start, profile: s.profile, version: s.version, table, rec };
    tables.push(entry);
    if (!latest || entry.start > latest.start) latest = entry;
  }
  // last_boot.log holds the newest boot's table; it stands in when that boot's
  // own records lack one (a JSONL sink may log the table differently).
  const lb = ctx.lastBoot;
  if (lb && Number.isFinite(lb.start) && lb.start >= sel.from && lb.start <= sel.to + 60_000) {
    if (!tables.some((t) => Math.abs(t.start - lb.start) < 5 * 60_000)) {
      const entry = { id: "last_boot.log", start: lb.start, profile: "-", table: lb, rec: null };
      tables.push(entry);
      if (!latest || entry.start > latest.start) latest = entry;
    }
  }
  const budget = ctx.budgets.boot_phase_ms ?? 1000;
  const loc = latest?.rec ? where(ctx, latest.rec) : { callsite: "-", context: "-" };
  const phaseMs = new Map();
  const totals = [];
  for (const t of tables) {
    if (Number.isFinite(t.table.total)) totals.push(t.table.total);
    for (const p of t.table.phases) {
      if (!phaseMs.has(p.name)) phaseMs.set(p.name, []);
      phaseMs.get(p.name).push(p.ms);
    }
  }
  const rows = [];
  for (const [name, ms] of phaseMs) {
    const max = Math.max(...ms);
    if (max < 100) continue;
    const cost = excess(ms, budget);
    const last = latest?.table.phases.find((p) => p.name === name)?.ms;
    rows.push({
      fp: fnv1a32(`perf|boot|${name}`),
      count: ms.length,
      cost: num(cost),
      _cost: cost,
      p50: num(percentile(ms, 50)),
      max: num(max),
      latest: last ?? "-",
      msg: `phase ${name}`,
      ...loc,
    });
  }
  rows.sort(byCost);
  if (totals.length) {
    rows.unshift({
      fp: latest?.rec?.fp ?? "-",
      count: totals.length,
      cost: "-",
      _cost: Infinity,
      p50: num(percentile(totals, 50)),
      max: num(Math.max(...totals)),
      latest: latest?.table.total ?? "-",
      msg: "Total setup (ms)",
      ...loc,
    });
  }
  const latestNote = latest
    ? `latest ${latest.id} ${isoShort(latest.start)} total=${latest.table.total ?? "?"}ms${latest.version ? ` version=${latest.version}` : ""}${latest.profile ? ` profile=${latest.profile}` : ""}`
    : "no startup timing table in the selection";
  const note = `${tables.length}/${boots} boots logged timing; ${latestNote}`;
  return { columns: [...BASE, "p50", "max", "latest", ...TAIL], rows, note };
}


function suppressedMap(records) {
  const out = new Map();
  for (const r of records) {
    if (r._class !== "suppressed") continue;
    const fp = r.f?.fp_suppressed;
    if (fp) out.set(fp, (out.get(fp) ?? 0) + (Number(r.f?.count) || 0));
  }
  return out;
}

function errors(ctx, sel, supp) {
  const rows = [];
  for (const [fp, group] of groupBy(
    sel.records.filter((r) => r._class === "error"),
    (r) => r.fp,
  )) {
    const count = group.length + (supp.get(fp) ?? 0);
    const cost = 1000 + count;
    rows.push({ fp, count, cost, _cost: cost, msg: sampleOf(group[0]), ...where(ctx, group[0]) });
  }
  rows.sort(byCost);
  return { columns: [...BASE, ...TAIL], rows };
}

function warnings(ctx, sel, supp) {
  const rows = [];
  let singles = 0;
  for (const [fp, group] of groupBy(
    sel.records.filter((r) => r._class === "warn"),
    (r) => r.fp,
  )) {
    const s = supp.get(fp) ?? 0;
    const count = group.length;
    if (count < 2 && s === 0) {
      singles += 1;
      continue;
    }
    const cost = count * (1 + s / (count + s));
    rows.push({ fp, count, supp: s, cost: num(cost), _cost: cost, msg: sampleOf(group[0]), ...where(ctx, group[0]) });
  }
  for (const [, group] of groupBy(
    sel.records.filter((r) => r._class === "swallow"),
    (r) => perfKey(r)?.fp,
  )) {
    const count = group.reduce((n, r) => n + (Number(r.f?.count) || 1), 0);
    const pk = perfKey(group[0]);
    rows.push({ fp: pk.fp, count, supp: 0, cost: count, _cost: count, msg: `swallowed tag=${pk.key}`, ...where(ctx, group[0]) });
  }
  rows.sort(byCost);
  const note = singles ? `${singles} single-occurrence warning fps not listed` : undefined;
  return { columns: ["fp", "count", "supp", "cost", ...TAIL], rows, note };
}

function slowIpc(ctx, sel) {
  const rows = [];
  for (const [, group] of groupBy(
    sel.records.filter((r) => r._class === "ipc"),
    (r) => perfKey(r)?.key,
  )) {
    const pk = perfKey(group[0]);
    const command = pk.key;
    const budget = ctx.budgets.commands?.[command] ?? ctx.budgets.ipc_ms ?? 300;
    const slow = group.filter((r) => r.tgt === "webview::ipc_slow");
    const windows = group.filter((r) => r.tgt === "webview::ipc_window");
    const slowMs = slow.map((r) => Number(r.f?.duration_ms) || 0);
    let calls;
    let p50;
    let p95;
    let max = slowMs.length ? Math.max(...slowMs) : undefined;
    let errs = slow.filter((r) => r.f?.ok === false).length;
    if (windows.length) {
      calls = windows.reduce((n, r) => n + (Number(r.f?.count) || 0), 0);
      const w = (k) => windows.reduce((n, r) => n + (Number(r.f?.[k]) || 0) * (Number(r.f?.count) || 0), 0) / (calls || 1);
      p50 = w("p50_ms");
      p95 = w("p95_ms");
      for (const r of windows) max = Math.max(max ?? 0, Number(r.f?.max_ms) || 0);
      errs += windows.reduce((n, r) => n + (Number(r.f?.errors) || 0) + (Number(r.f?.timeouts) || 0), 0);
    } else {
      calls = slow.length;
      p50 = percentile(slowMs, 50);
      p95 = percentile(slowMs, 95);
    }
    const cost = excess(slowMs, budget);
    rows.push({
      fp: pk.fp,
      count: calls,
      cost: num(cost),
      _cost: cost,
      slow: slow.length,
      p50: num(p50),
      p95: num(p95),
      max: num(max),
      err: errs,
      msg: command,
      callsite: "-",
      context: "-",
    });
  }
  rows.sort(byCost);
  return { columns: [...BASE, "slow", "p50", "p95", "max", "err", ...TAIL], rows };
}

function perfGroups(ctx, records, section, durationOf, budget, label) {
  const rows = [];
  for (const [, group] of groupBy(
    records.filter((r) => perfKey(r)?.section === section),
    (r) => perfKey(r).key,
  )) {
    const pk = perfKey(group[0]);
    const ds = group.map(durationOf).filter((d) => Number.isFinite(d));
    const cost = excess(ds, budget);
    rows.push({
      fp: pk.fp,
      count: group.length,
      cost: num(cost),
      _cost: cost,
      p95: num(percentile(ds, 95)),
      max: num(ds.length ? Math.max(...ds) : undefined),
      msg: label(pk.key, group[0]),
      ...where(ctx, group[0]),
    });
  }
  return rows;
}

function slowDb(ctx, sel) {
  const rows = perfGroups(ctx, sel.records, "db", (r) => Number(r.f?.duration_ms), ctx.budgets.db_ms ?? 100, (k) => k);
  for (const r of rows) [r.callsite, r.context] = ["-", "-"];
  rows.sort(byCost);
  return { columns: [...BASE, "p95", "max", ...TAIL], rows };
}

function render(ctx, sel) {
  const ms = (r) => Number(r.f?.duration_ms);
  const rows = [
    ...perfGroups(ctx, sel.records, "long_task", ms, ctx.budgets.long_task_ms ?? 50, (k) => `long_task route=${k}`),
    ...perfGroups(ctx, sel.records, "commit", ms, ctx.budgets.commit_ms ?? 50, (k, r) => `commit profiler=${k} route=${r.f?.route ?? "-"}`),
  ];
  rows.sort(byCost);
  return { columns: [...BASE, "p95", "max", ...TAIL], rows };
}

function spans(ctx, sel) {
  const rows = perfGroups(ctx, sel.records, "span", (r) => Number(r.f?.busy_ms), ctx.budgets.span_ms ?? 200, (k) => `span ${k}`);
  rows.sort(byCost);
  return { columns: [...BASE, "p95", "max", ...TAIL], rows };
}

function toolchain(ctx, sel) {
  const rows = [];
  for (const [fp, group] of groupBy(
    sel.records.filter((r) => r._class === "toolchain"),
    (r) => r.fp,
  )) {
    const first = group[0];
    const cost = first.lvl === "ERROR" ? 1000 + group.length : group.length;
    const f = first.f ?? {};
    const code = f.code && f.code !== f.text ? `[${cut(f.code, 40)}] ` : "";
    rows.push({ fp, count: group.length, cost, _cost: cost, msg: `${first.tgt} ${first.lvl.toLowerCase()} ${code}${f.text ?? first.msg}`, ...where(ctx, first) });
  }
  const builds = sel.records.filter((r) => r._class === "build");
  if (builds.length) {
    const ds = builds.map((r) => Number(r.f?.duration_s)).filter(Number.isFinite);
    rows.push({
      fp: builds[0].fp,
      count: builds.length,
      cost: 0,
      _cost: 0,
      p50: num(percentile(ds, 50), 1),
      max: num(ds.length ? Math.max(...ds) : undefined, 1),
      msg: `cargo.build durations (s) last=${num(ds.at(-1), 1)}`,
      callsite: "-",
      context: "-",
    });
  }
  rows.sort(byCost);
  return { columns: [...BASE, "p50", "max", ...TAIL], rows };
}

function newSince(ctx, sel) {
  const focus = sel.focus;
  const prev = previousSession(ctx.model, focus, { allProfiles: ctx.allProfiles });
  if (!focus) return { columns: [...BASE, ...TAIL], rows: [], note: "no app session in the selection" };
  if (!prev) return { columns: [...BASE, ...TAIL], rows: [], note: `no session before ${focus.id} to compare with` };
  const before = ctx.fpsBySession.get(prev.id) ?? new Set();
  const rows = [];
  const mine = ctx.model.records.filter((r) => (r.boot ?? "unknown") === focus.id && (r.lvl === "WARN" || r.lvl === "ERROR"));
  for (const [fp, group] of groupBy(mine, (r) => r.fp)) {
    if (before.has(fp)) continue;
    const cost = group[0].lvl === "ERROR" ? 1000 + group.length : group.length;
    rows.push({ fp, count: group.length, cost, _cost: cost, msg: sampleOf(group[0]), ...where(ctx, group[0]) });
  }
  rows.sort(byCost);
  return { columns: [...BASE, ...TAIL], rows, note: `${focus.id} vs previous ${prev.id}` };
}

function ledgerSection(ctx, sel) {
  const rows = [];
  for (const e of ctx.ledgerEntries) {
    const t = Date.parse(e.ts);
    if (t >= sel.from && t <= sel.to) rows.push({ fp: e.fp, status: e.status, sha: e.sha, ts: e.ts.slice(0, 19) + "Z", note: e.note, _cost: 0 });
  }
  for (const tr of ctx.transitions) {
    rows.push({ fp: tr.fp, status: `${tr.to} (candidate)`, sha: "-", ts: tr.since.slice(0, 19) + "Z", note: `${tr.from} -> ${tr.to}, session ${tr.session}`, _cost: 1 });
  }
  rows.sort(byCost);
  return { columns: ["fp", "status", "sha", "ts", "note"], rows };
}

// ── assembly ────────────────────────────────────────────────────────────────

function indexBoots(model) {
  const tables = new Map();
  const setupMs = new Map();
  for (const r of model.records) {
    if (r.src === "toolchain") continue;
    const id = r.boot ?? "unknown";
    if (r.msg === "Backend setup completed" && r.f?.total_ms !== undefined) setupMs.set(id, Number(r.f.total_ms));
    if (!tables.has(id) && tableTextOf(r)) tables.set(id, r);
  }
  return { tables, setupMs };
}

/** Give each section rows round-robin until `budget` rows are spent. */
export function applyBudget(sections, budget) {
  const quotas = sections.map((s) => (s.fixed ? s.rows.length : 0));
  let remaining = Math.max(0, budget);
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    sections.forEach((s, i) => {
      if (s.fixed || remaining <= 0 || quotas[i] >= s.rows.length) return;
      quotas[i] += 1;
      remaining -= 1;
      progress = true;
    });
  }
  return sections.map((s, i) => ({ ...s, total: s.rows.length, rows: s.rows.slice(0, quotas[i]), cut: s.rows.length - quotas[i] }));
}

/**
 * @param {object} model loadModel() result
 * @param {object} sel select() result
 * @param {object} opts { budgets, budget, ledgerEntries, latestLedger, contextIndex, lastBootPath, allProfiles }
 */
export function buildDigest(model, sel, opts) {
  const { tables, setupMs } = indexBoots(model);
  const bySession = fpsBySession(model);
  const devSessions = appSessions(model, { allProfiles: false }).map((s) => ({ id: s.id, start: s.start, fps: bySession.get(s.id) ?? new Set() }));
  const ctx = {
    model,
    budgets: opts.budgets ?? {},
    contextIndex: opts.contextIndex,
    allProfiles: opts.allProfiles,
    tables,
    setupMs,
    lastBoot: opts.lastBootPath ? readLastBoot(opts.lastBootPath) : null,
    fpsBySession: bySession,
    ledgerEntries: opts.ledgerEntries ?? [],
    transitions: opts.latestLedger ? deriveTransitions(opts.latestLedger, devSessions) : [],
  };
  const supp = suppressedMap(sel.records);
  const built = {
    Coverage: coverage(sel.records, sel.focus),
    "Boot phases": bootPhases(ctx, sel),
    Errors: errors(ctx, sel, supp),
    "Repeating warnings": warnings(ctx, sel, supp),
    "Slow IPC": slowIpc(ctx, sel),
    "Slow DB": slowDb(ctx, sel),
    Render: render(ctx, sel),
    "Rust spans": spans(ctx, sel),
    Toolchain: toolchain(ctx, sel),
    "New since previous session": newSince(ctx, sel),
    Ledger: ledgerSection(ctx, sel),
  };
  const sections = applyBudget(
    SECTION_ORDER.map((name) => ({ name, ...built[name] })),
    opts.budget ?? 120,
  ).map((s) => ({ ...s, rows: s.rows.map(stripPrivate) }));
  const legacyFiles = model.stats.files.filter((f) => f.kind === "legacy").length;
  const meta = {
    selection: sel.label,
    from: isoShort(sel.from),
    to: isoShort(sel.to),
    records: sel.records.length,
    records_total: model.records.length,
    files: { legacy: legacyFiles, app_jsonl: model.stats.files.filter((f) => f.kind === "app").length, toolchain: model.stats.files.filter((f) => f.kind === "toolchain").length },
    malformed_lines: model.stats.malformed,
    focus: sel.focus ? { id: sel.focus.id, profile: sel.focus.profile, start: isoShort(sel.focus.start) } : null,
    profiles: opts.allProfiles ? "all" : "debug+unknown",
    budgets: ctx.budgets,
    budget_rows: opts.budget ?? 120,
    logs_dir: model.logsDir,
  };
  return { meta, sections, transitions: ctx.transitions };
}

function stripPrivate(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith("_")) out[k] = v;
  return out;
}

export function renderDigestText(d, { elapsedMs } = {}) {
  const m = d.meta;
  const b = m.budgets;
  const lines = [
    `devlog digest | ${m.selection} | ${m.from} .. ${m.to} | records ${m.records}/${m.records_total} | files legacy=${m.files.legacy} jsonl=${m.files.app_jsonl} toolchain=${m.files.toolchain}${m.malformed_lines ? ` malformed=${m.malformed_lines}` : ""} | profiles ${m.profiles}`,
    `focus ${m.focus ? `${m.focus.id} (${m.focus.profile}, ${m.focus.start})` : "-"} | budgets ipc=${b.ipc_ms}ms db=${b.db_ms}ms long_task=${b.long_task_ms}ms commit=${b.commit_ms}ms span=${b.span_ms}ms boot_phase=${b.boot_phase_ms}ms | rows<=${m.budget_rows}${elapsedMs !== undefined ? ` | ${elapsedMs}ms` : ""}`,
    `cost: error=1000+count  warn=count*(1+supp/(count+supp))  perf=sum(ms over budget)`,
  ];
  for (const s of d.sections) {
    lines.push("");
    lines.push(`## ${s.name} (${s.rows.length}/${s.total})${s.note ? ` - ${s.note}` : ""}`);
    if (!s.rows.length) {
      lines.push("(none)");
      continue;
    }
    lines.push(...table(s.columns, s.rows));
    if (s.cut > 0) lines.push(`(+${s.cut} rows cut)`);
  }
  return lines.join("\n") + "\n";
}
