// Digest over a synthetic logs dir (JSONL app records + a legacy text day +
// toolchain JSONL): coverage, budget truncation, sections, context join,
// "new since previous session", ledger transitions and the CLI surface.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../cli.mjs";
import { contextOf, loadContextIndex, repoPathOf } from "../lib/context.mjs";
import { applyBudget, buildDigest, renderDigestText } from "../lib/digest.mjs";
import { makeRecord, toLine } from "../lib/envelope.mjs";
import { appendLedger, deriveTransitions, latestByFp, readLedger } from "../lib/ledger.mjs";
import { loadModel, select } from "../lib/model.mjs";

const BUDGETS = { ipc_ms: 300, db_ms: 100, long_task_ms: 50, commit_ms: 50, span_ms: 200, boot_phase_ms: 1000, commands: { slow_cmd: 500 } };
const DAY = "2026-10-05";
const at = (h, m, s = 0) => `${DAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000000Z`;
const NOW = Date.parse(`${DAY}T23:00:00Z`);

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function app(boot, ts, lvl, tgt, msg, extra = {}) {
  return makeRecord({ ts, lvl, src: tgt.startsWith("webview::") ? "webview" : "rust", tgt, msg, boot, ...extra });
}

/** Two debug boots + one release boot in JSONL, a legacy day before them, one toolchain session. */
function buildLogsDir() {
  const dir = tmpDir("devlog-digest-");
  const B1 = "11111111-1111-4111-8111-111111111111";
  const B2 = "22222222-2222-4222-8222-222222222222";
  const REL = "33333333-3333-4333-8333-333333333333";
  const SESSION = "44444444-4444-4444-8444-444444444444";
  const recs = [
    app(B1, at(8, 0), "INFO", "app_lib::logging", "boot.start", { f: { version: "1.1.0", profile: "debug", pid: 1, os: "windows" } }),
    app(B1, at(8, 1), "WARN", "app_lib::engine::kp_reporter", "KP report push failed", { file: "src/engine/kp_reporter.rs", line: 397, f: { what: "rollup" } }),
    app(B1, at(8, 2), "WARN", "app_lib::old", "only in boot one", { file: "src/old.rs", line: 1 }),
    app(B1, at(8, 2, 30), "WARN", "app_lib::old", "only in boot one", { file: "src/old.rs", line: 1 }),
    app(B2, at(9, 0), "INFO", "app_lib::logging", "boot.start", { f: { version: "1.1.0", profile: "debug", pid: 2, os: "windows", devlog_session: SESSION } }),
    app(B2, at(9, 0, 50), "INFO", "app_lib::boot::finalize", "Backend setup completed", { f: { total_ms: 59715 } }),
    app(B2, at(9, 0, 51), "INFO", "app_lib::boot::finalize", "=== Startup Timing ===\nTotal setup: 59715ms\n  db_init      59098ms  (at 59408ms)\n  user_db_init    62ms  (at 59471ms)\n  cdc_drain_task 184ms  (at 59705ms)", { file: "src/boot/finalize.rs", line: 22 }),
    ...Array.from({ length: 5 }, (_, i) => app(B2, at(9, 1, i), "WARN", "app_lib::engine::kp_reporter", "KP report push failed", { file: "src/engine/kp_reporter.rs", line: 397, f: { what: "rollup" } })),
    app(B2, at(9, 2), "INFO", "devlog", "log.suppressed", { f: { fp_suppressed: makeRecord({ lvl: "WARN", tgt: "app_lib::engine::kp_reporter", msg: "KP report push failed" }).fp, count: 80, window_s: 60 } }),
    ...Array.from({ length: 3 }, (_, i) => app(B2, at(9, 3, i), "WARN", "personas_engine::responsibility", "responsibility: a project holds more than one active software charter", { file: "engine/src/responsibility.rs", line: 571 })),
    app(B2, at(9, 4), "ERROR", "app_lib::engine::new_thing", "brand new failure", { file: "src/engine/new_thing.rs", line: 9 }),
    app(B2, at(9, 5), "WARN", "personas_db::perf", "Slow DB query detected", { file: "db/src/perf.rs", line: 259, f: { table: "app_settings", operation: "app_settings::set", duration_ms: 17200 } }),
    app(B2, at(9, 5, 1), "WARN", "personas_db::perf", "Slow DB query detected", { file: "db/src/perf.rs", line: 259, f: { table: "app_settings", operation: "app_settings::set", duration_ms: 300 } }),
    app(B2, at(9, 6), "WARN", "webview::ipc_slow", "ipc slow", { f: { command: "slow_cmd", duration_ms: 900, ok: true, route: "home" } }),
    app(B2, at(9, 6, 1), "WARN", "webview::ipc_slow", "ipc slow", { f: { command: "list_personas", duration_ms: 700, ok: false, route: "home" } }),
    app(B2, at(9, 6, 2), "INFO", "webview::ipc_window", "ipc window", { f: { command: "list_personas", count: 40, p50_ms: 20, p95_ms: 650, max_ms: 700, errors: 1, timeouts: 0 } }),
    app(B2, at(9, 7), "INFO", "webview::long_task", "long task", { f: { duration_ms: 180, route: "overview" } }),
    app(B2, at(9, 7, 1), "INFO", "webview::commit", "slow commit", { f: { profiler_id: "overview", duration_ms: 120, phase: "update", route: "overview" } }),
    app(B2, at(9, 8), "INFO", "app_lib::commands::core::personas", "span.close", { file: "src/commands/core/personas.rs", line: 40, f: { span: "list_personas", busy_ms: 450, idle_ms: 3 } }),
    app(REL, at(10, 0), "INFO", "app_lib::logging", "boot.start", { f: { version: "1.1.0", profile: "release", pid: 3, os: "windows" } }),
    app(REL, at(10, 1), "ERROR", "app_lib::prod_only", "release-only failure"),
  ];
  fs.writeFileSync(path.join(dir, `personas.${DAY}.jsonl`), recs.map(toLine).join(""));
  const tc = [
    makeRecord({ ts: at(8, 59), lvl: "INFO", src: "toolchain", tgt: "devlog", msg: "session.start", boot: SESSION, f: { script: "tauri:dev:lite" } }),
    makeRecord({ ts: at(8, 59, 10), lvl: "WARN", src: "toolchain", tgt: "cargo", msg: "cargo.warning", boot: SESSION, file: "src/engine/kp_reporter.rs", line: 412, f: { code: "unused_variables", text: "unused variable: `elapsed`" } }),
    makeRecord({ ts: at(8, 59, 20), lvl: "INFO", src: "toolchain", tgt: "cargo", msg: "cargo.build", boot: SESSION, f: { duration_s: 83 } }),
    makeRecord({ ts: at(9, 9), lvl: "ERROR", src: "toolchain", tgt: "vite", msg: "vite.error", boot: SESSION, file: "src/App.tsx", line: 3, f: { code: "PARSE_ERROR", text: "Unexpected token" } }),
    "{ not json\n",
  ];
  fs.writeFileSync(path.join(dir, `toolchain.${DAY}.jsonl`), tc.map((r) => (typeof r === "string" ? r : toLine(r))).join(""));
  fs.copyFileSync(fileURLToPath(new URL("./fixtures/legacy.log", import.meta.url)), path.join(dir, "personas.2026-10-04.log"));
  return { dir, B1, B2, REL, SESSION };
}

async function digestOf(dir, selection, extra = {}) {
  const model = await loadModel(dir);
  const sel = select(model, { now: NOW, ...selection });
  return { model, d: buildDigest(model, sel, { budgets: BUDGETS, budget: 200, contextIndex: loadContextIndex(), ...extra }) };
}

const section = (d, name) => d.sections.find((s) => s.name === name);

test("coverage lists every producer and says NOT CAPTURED for silent ones", async () => {
  const { dir } = buildLogsDir();
  const { d } = await digestOf(dir, { since: "1d" });
  const cov = section(d, "Coverage");
  const byName = Object.fromEntries(cov.rows.map((r) => [r.producer, r.count]));
  assert.equal(byName["swallow_rollup"], "NOT CAPTURED");
  assert.equal(cov.rows.find((r) => r.producer === "freeze/store_alert").source, "legacy-text");
  assert.equal(byName["commit"], 1);
  assert.equal(byName["toolchain tauri"], "NOT CAPTURED");
  assert.ok(byName["rust"] > 0 && byName["ipc_slow"] === 2 && byName["db slow query"] === 3 && byName["toolchain vite"] === 1);
  for (const r of cov.rows) assert.notEqual(String(r.count).trim(), "", `${r.producer} is never blank`);
  const text = renderDigestText(d);
  assert.match(text, /swallow_rollup\s+NOT CAPTURED/);
  assert.equal(d.meta.malformed_lines, 1);
});

test("sections rank by cost and fold suppressed counts in", async () => {
  const { dir } = buildLogsDir();
  const { d } = await digestOf(dir, { session: "222" });
  const warn = section(d, "Repeating warnings");
  assert.equal(warn.rows[0].msg.startsWith("KP report push failed"), true);
  assert.equal(warn.rows[0].count, 5);
  assert.equal(warn.rows[0].supp, 80);
  assert.equal(warn.rows[0].callsite, "src-tauri/src/engine/kp_reporter.rs:397");
  assert.equal(Number(warn.rows[0].cost), Math.round(5 * (1 + 80 / 85)));
  const errors = section(d, "Errors");
  assert.deepEqual(errors.rows.map((r) => [r.count, r.cost]), [[1, 1001]]);
  const ipc = section(d, "Slow IPC");
  assert.deepEqual(ipc.rows.map((r) => r.msg), ["list_personas", "slow_cmd"]);
  assert.equal(ipc.rows[0].cost, "400");
  assert.equal(ipc.rows[1].cost, "400", "per-command budget 500 ms applies");
  assert.equal(ipc.rows[0].count, 40, "calls come from ipc_window when present");
  const db = section(d, "Slow DB");
  assert.equal(db.rows[0].msg, "app_settings app_settings::set");
  assert.equal(db.rows[0].cost, String(17100 + 200));
  const render = section(d, "Render");
  assert.deepEqual(render.rows.map((r) => r.cost), ["130", "70"]);
  assert.equal(section(d, "Rust spans").rows[0].cost, "250");
  const boot = section(d, "Boot phases");
  assert.equal(boot.rows[0].msg, "Total setup (ms)");
  assert.equal(boot.rows[1].msg, "phase db_init");
  assert.equal(boot.rows[1].cost, "58098");
  const tool = section(d, "Toolchain");
  assert.equal(tool.rows[0].cost, 1001, "vite error first");
  assert.ok(tool.rows.some((r) => /cargo.build/.test(r.msg)));
  assert.equal(section(d, "Errors").rows.some((r) => /release-only/.test(r.msg)), false);
});

test("release boots are hidden unless --all-profiles", async () => {
  const { dir } = buildLogsDir();
  const hidden = (await digestOf(dir, { since: "1d" })).d;
  assert.ok(!section(hidden, "Errors").rows.some((r) => /release-only/.test(r.msg)));
  const shown = (await digestOf(dir, { since: "1d", allProfiles: true }, { allProfiles: true })).d;
  assert.ok(section(shown, "Errors").rows.some((r) => /release-only/.test(r.msg)));
});

test("session selection joins the app boot and its toolchain session both ways", async () => {
  const { dir, B2, SESSION } = buildLogsDir();
  const model = await loadModel(dir);
  const byBoot = select(model, { session: B2 });
  const bySession = select(model, { session: SESSION });
  assert.ok(byBoot.records.some((r) => r.tgt === "vite"));
  assert.ok(bySession.records.some((r) => r.boot === B2));
  assert.equal(byBoot.records.length, bySession.records.length);
  assert.equal(select(model, { session: "last" }).focus.id, B2, "release boot is skipped by default");
});

test("new since previous session compares with the previous dev boot", async () => {
  const { dir, B1 } = buildLogsDir();
  const { d } = await digestOf(dir, { session: "last" });
  const s = section(d, "New since previous session");
  assert.match(s.note, new RegExp(`vs previous ${B1}`));
  const msgs = s.rows.map((r) => r.msg);
  assert.ok(msgs.some((m) => m.startsWith("brand new failure")));
  assert.ok(!msgs.some((m) => m.startsWith("KP report push failed")), "present in the previous boot");
});

test("budget truncation keeps every section reachable and states the rows cut", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ fp: String(i), _cost: n - i }));
  const out = applyBudget(
    [
      { name: "Coverage", fixed: true, rows: rows(13) },
      { name: "A", rows: rows(10) },
      { name: "B", rows: rows(1) },
      { name: "C", rows: rows(6) },
    ],
    7,
  );
  assert.deepEqual(out.map((s) => [s.rows.length, s.cut]), [[13, 0], [3, 7], [1, 0], [3, 3]]);
  const text = renderDigestText({
    meta: { selection: "x", from: "-", to: "-", records: 0, records_total: 0, files: { legacy: 0, app_jsonl: 0, toolchain: 0 }, malformed_lines: 0, focus: null, profiles: "p", budgets: BUDGETS, budget_rows: 7 },
    sections: out.map((s) => ({ ...s, columns: ["fp"] })),
  });
  assert.match(text, /## A \(3\/10\)\n[\s\S]*\(\+7 rows cut\)/);
  assert.match(text, /## C \(3\/6\)\n[\s\S]*\(\+3 rows cut\)/);
});

test("context join: cargo-relative Rust paths, exact files, deepest owning dir", () => {
  assert.equal(repoPathOf({ src: "rust", file: "db/src/perf.rs" }), "src-tauri/db/src/perf.rs");
  assert.equal(repoPathOf({ src: "toolchain", tgt: "cargo", file: "src\\engine\\x.rs" }), "src-tauri/src/engine/x.rs");
  assert.equal(repoPathOf({ src: "toolchain", tgt: "vite", file: "src/App.tsx" }), "src/App.tsx");
  const dir = tmpDir("devlog-ctx-");
  const map = path.join(dir, "context-map.json");
  fs.writeFileSync(
    map,
    JSON.stringify({
      contexts: [
        { name: "db-perf", file_paths: ["src-tauri\\db\\src\\perf.rs"] },
        { name: "engine", file_paths: ["src-tauri/src/engine/a.rs", "src-tauri/src/engine/b.rs"] },
        { name: "other", file_paths: ["src-tauri/src/engine/sub/c.rs"] },
      ],
    }),
  );
  const index = loadContextIndex(map);
  assert.equal(contextOf(index, "src-tauri/db/src/perf.rs"), "db-perf");
  assert.equal(contextOf(index, "src-tauri/src/engine/new.rs"), "engine");
  assert.equal(contextOf(index, "src-tauri/src/engine/sub/d.rs"), "other");
  assert.equal(contextOf(index, "src/unknown/x.ts"), "-");
  assert.equal(contextOf(loadContextIndex(path.join(dir, "missing.json")), "src-tauri/db/src/perf.rs"), "-");
});

test("ledger transitions: confirmed when absent after the fix, regressed when back", () => {
  const sessions = [
    { id: "s1", start: Date.parse("2026-10-05T08:00:00Z"), fps: new Set(["aaaaaaaa", "bbbbbbbb"]) },
    { id: "s2", start: Date.parse("2026-10-05T10:00:00Z"), fps: new Set(["bbbbbbbb"]) },
  ];
  const latest = latestByFp([
    { ts: "2026-10-05T09:00:00.000000Z", fp: "aaaaaaaa", status: "fixed", sha: "abc123" },
    { ts: "2026-10-05T09:00:00.000000Z", fp: "bbbbbbbb", status: "fixed" },
    { ts: "2026-10-05T09:00:00.000000Z", fp: "cccccccc", status: "open" },
    { ts: "2026-10-05T11:00:00.000000Z", fp: "dddddddd", status: "fixed" },
  ]);
  const tr = deriveTransitions(latest, sessions);
  assert.deepEqual(
    tr.map((t) => [t.fp, t.to]),
    [
      ["aaaaaaaa", "confirmed"],
      ["bbbbbbbb", "regressed"],
    ],
  );
});

test("CLI: ledger set/list round trip, digest --apply-ledger appends the derived transition", async () => {
  const { dir } = buildLogsDir();
  const ledger = path.join(tmpDir("devlog-ledger-"), "ledger.jsonl");
  let out = "";
  const io = { out: (s) => (out += s), err: (s) => (out += s) };
  const oldFp = makeRecord({ lvl: "WARN", tgt: "app_lib::old", msg: "only in boot one" }).fp;
  appendLedger(ledger, { fp: oldFp, status: "fixed", sha: "deadbee", ts: `${DAY}T08:30:00.000000Z` });
  assert.equal(await main(["ledger", "set", "zz", "fixed", "--ledger", ledger], io), 2, "bad fp is a usage error");
  assert.equal(await main(["ledger", "list", "--ledger", ledger], io), 0);
  assert.match(out, new RegExp(`${oldFp}\\s+fixed\\s+deadbee`));
  out = "";
  assert.equal(await main(["digest", "--logs", dir, "--ledger", ledger, "--session", "last", "--apply-ledger"], io), 0);
  assert.match(out, /confirmed \(candidate\)/);
  const entries = readLedger(ledger);
  assert.equal(entries.at(-1).status, "confirmed");
  assert.equal(entries.at(-1).fp, oldFp);
});

test("CLI: sessions, show, diff and digest --json", async () => {
  const { dir, B1, B2 } = buildLogsDir();
  let out = "";
  const io = { out: (s) => (out += s), err: (s) => (out += s) };
  assert.equal(await main(["sessions", "--logs", dir], io), 0);
  assert.match(out, new RegExp(B2));
  assert.doesNotMatch(out, /33333333-/, "release boot hidden");
  out = "";
  await main(["sessions", "--logs", dir, "--all"], io);
  assert.match(out, /33333333-/);

  out = "";
  const kpFp = makeRecord({ lvl: "WARN", tgt: "app_lib::engine::kp_reporter", msg: "KP report push failed" }).fp;
  assert.equal(await main(["show", "--logs", dir, "--fp", kpFp, "--n", "2"], io), 0);
  assert.match(out, /count 7 /);
  assert.match(out, /what: 1 distinct: rollup x7/);
  assert.equal(out.trim().split("\n").filter((l) => l.startsWith("{")).length, 2);

  out = "";
  assert.equal(await main(["diff", "--logs", dir, "--before", B1, "--after", B2], io), 0);
  assert.match(out, /regressed\s+1\s+5 .*KP report push failed/);
  assert.match(out, /gone\s+2\s+0 .*only in boot one/);
  assert.match(out, /new\s+0\s+2\s+.*db app_settings/);

  out = "";
  assert.equal(await main(["digest", "--logs", dir, "--session", "last", "--json", "--budget", "5"], io), 0);
  const json = JSON.parse(out);
  assert.equal(json.sections.length, 11);
  assert.equal(json.sections.filter((s) => s.name !== "Coverage").reduce((n, s) => n + s.rows.length, 0), 5);
  assert.equal(await main(["digest", "--logs", dir, "--walk", "nope"], io), 1);
});
