// The capture side: the tauri:dev wrapper (byte-identical pass-through, exit
// code, session env, toolchain JSONL), the Vite plugin recorder, and the walk.
// Every write goes to a temp logs dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createViteRecorder, devlogVitePlugin } from "../vite-plugin.mjs";
import { parseNavSections, REGISTRY, runWalk } from "../walk.mjs";
import { STDERR_PAYLOAD, STDOUT_PAYLOAD } from "./fixtures/fake-tauri.mjs";

const RUN = fileURLToPath(new URL("../run.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-tauri.mjs", import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const readJsonl = (dir) =>
  fs
    .readdirSync(dir)
    .filter((n) => /^toolchain\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .flatMap((n) => fs.readFileSync(path.join(dir, n), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));

test("wrapper: output byte-identical, exit code propagated, session env set, diagnostics recorded", () => {
  const data = tmp("devlog-run-");
  const sessionFile = path.join(data, "session.json");
  const r = spawnSync(process.execPath, [RUN, "--config", "x.json", "--", "--features", "test-automation"], {
    env: { ...process.env, PERSONAS_DATA_DIR: data, DEVLOG_LOGS_DIR: "", DEVLOG_CHILD: `node ${FAKE}`, FAKE_EXIT: "3", FAKE_SESSION_FILE: sessionFile, npm_lifecycle_event: "tauri:dev:test" },
    maxBuffer: 1 << 24,
  });
  assert.equal(r.status, 3, "child exit code propagates");
  assert.ok(Buffer.compare(r.stdout, STDOUT_PAYLOAD) === 0, "stdout byte-identical");
  assert.ok(Buffer.compare(r.stderr, STDERR_PAYLOAD) === 0, "stderr byte-identical");

  const seen = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  assert.match(seen.session, /^[0-9a-f-]{36}$/);
  assert.deepEqual(seen.args, ["--config", "x.json", "--", "--features", "test-automation"]);

  const recs = readJsonl(path.join(data, "logs"));
  assert.ok(recs.every((x) => x.boot === seen.session && x.src === "toolchain" && /^[0-9a-f]{8}$/.test(x.fp)));
  assert.equal(recs[0].msg, "session.start");
  assert.equal(recs[0].f.script, "tauri:dev:test");
  assert.equal(recs.at(-1).msg, "session.end");
  assert.equal(recs.at(-1).f.exit_code, 3);
  assert.ok(recs.at(-1).f.duration_ms >= 0);
  const diag = recs.filter((x) => x.tgt === "cargo" && x.msg !== "cargo.build").map((x) => `${x.lvl} ${x.f.code} ${x.file ?? "-"}:${x.line ?? "-"}`);
  assert.deepEqual(diag, [
    "WARN  src/main.rs:1",
    "WARN unused_variables src/engine/kp_reporter.rs:412",
    "WARN clippy::if_same_then_else db/src/perf.rs:250",
    "ERROR E0308 src/commands/core/personas.rs:42",
    "ERROR could_not_compile -:-",
  ]);
  assert.equal(recs.filter((x) => x.msg === "cargo.build").length, 1);
  const tauri = recs.filter((x) => x.tgt === "tauri");
  assert.deepEqual(tauri.map((x) => [x.lvl, x.f.text]), [["ERROR", "[tauri_cli] boom happened"]]);
  assert.ok(!recs.some((x) => x.tgt === "vite"), "nothing Vite-shaped before ready in this payload");
  for (const line of fs.readFileSync(path.join(data, "logs", fs.readdirSync(path.join(data, "logs"))[0]), "utf8").split("\n").filter(Boolean)) {
    assert.match(JSON.parse(line).ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  }
});

test("wrapper: an unwritable logs dir costs one warning, never the run", () => {
  const data = tmp("devlog-run-ro-");
  const blocker = path.join(data, "logs");
  fs.writeFileSync(blocker, "a file where the logs dir should be");
  const r = spawnSync(process.execPath, [RUN], { env: { ...process.env, PERSONAS_DATA_DIR: data, DEVLOG_LOGS_DIR: "", DEVLOG_CHILD: `node ${FAKE}`, FAKE_EXIT: "0" } });
  assert.equal(r.status, 0);
  assert.ok(Buffer.compare(r.stdout, STDOUT_PAYLOAD) === 0);
  const warnings = r.stderr.toString().split("\n").filter((l) => l.startsWith("[devlog]"));
  assert.equal(warnings.length, 1, r.stderr.toString());
});

test("vite recorder: logger errors with loc, HMR dedupe, reload storm", () => {
  const recs = [];
  let now = 1_000_000;
  const rec = createViteRecorder({ write: (r) => recs.push(r), now: () => now, session: "s-1" });
  const err = { message: "Transform failed", plugin: "vite:oxc", id: "C:/repo/src/App.tsx?v=1", loc: { file: "C:/repo/src/App.tsx", line: 12, column: 4 } };
  rec.log("error", "\x1b[31mInternal server error: Transform failed\x1b[39m", { error: err });
  rec.hmr({ type: "error", err });
  assert.equal(recs.length, 1, "overlay payload for an error the logger just recorded is not counted twice");
  assert.deepEqual([recs[0].lvl, recs[0].tgt, recs[0].file, recs[0].line, recs[0].f.plugin, recs[0].f.id, recs[0].boot], ["ERROR", "vite", "C:/repo/src/App.tsx", 12, "vite:oxc", "C:/repo/src/App.tsx", "s-1"]);
  now += 5000;
  rec.hmr({ type: "error", err: { message: "Another failure" } });
  assert.equal(recs.at(-1).msg, "vite.hmr_error");
  rec.log("warn", "(!) something odd", undefined);
  assert.equal(recs.at(-1).lvl, "WARN");
  const before = recs.length;
  for (let i = 0; i < 12; i++) {
    now += 1000;
    rec.hmr({ type: "full-reload", path: "*" });
  }
  const storms = recs.slice(before);
  assert.equal(storms.length, 1, "one WARN per storm window");
  assert.equal(storms[0].msg, "vite.reload_storm");
  assert.equal(storms[0].f.reloads_per_min, 6);
});

test("vite plugin: serve-only, wraps the logger without changing what it prints", async () => {
  const plugin = devlogVitePlugin();
  assert.equal(plugin.apply, "serve");
  const printed = [];
  const logger = { warn: (m) => printed.push(["warn", m]), warnOnce: (m) => printed.push(["warnOnce", m]), error: (m) => printed.push(["error", m]), info: () => {} };
  const logs = tmp("devlog-vite-");
  const saved = { VITEST: process.env.VITEST, DEVLOG_LOGS_DIR: process.env.DEVLOG_LOGS_DIR, PERSONAS_DEVLOG_SESSION: process.env.PERSONAS_DEVLOG_SESSION };
  delete process.env.VITEST;
  process.env.DEVLOG_LOGS_DIR = logs;
  process.env.PERSONAS_DEVLOG_SESSION = "sess-x";
  try {
    plugin.configResolved({ command: "serve", logger });
    logger.warn("w1");
    logger.warnOnce("w2");
    logger.warnOnce("w2");
    logger.error("e1", { error: new Error("e1") });
    const sent = [];
    const server = { ws: { send: (p) => sent.push(p) } };
    plugin.configureServer(server);
    server.ws.send({ type: "full-reload", path: "*" });
    assert.deepEqual(printed, [["warn", "w1"], ["warnOnce", "w2"], ["warnOnce", "w2"], ["error", "e1"]], "original logger output unchanged");
    assert.equal(sent.length, 1, "HMR payload still delivered");
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // The writer streams asynchronously; poll until the three lines land.
  const deadline = Date.now() + 5000;
  let recs = [];
  while (Date.now() < deadline) {
    recs = fs.existsSync(logs) ? readJsonl(logs) : [];
    if (recs.length >= 3) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.deepEqual(recs.map((r) => r.msg), ["vite.warning", "vite.warning", "vite.error"], "warnOnce recorded once");
  assert.ok(recs.every((r) => r.boot === "sess-x"));
});

test("walk: sections parsed from NAV_SECTIONS source", () => {
  const sections = parseNavSections(fs.readFileSync(REGISTRY, "utf8"));
  const ids = sections.map((s) => s.id);
  assert.ok(ids.includes("home") && ids.includes("settings") && ids.includes("schedules"));
  assert.equal(sections.find((s) => s.id === "schedules").reachability, "overlay-only");
  assert.equal(sections.find((s) => s.id === "design-reviews").reachability, "nested");
});

function fakeServer({ healthOk = true, snapshot = true } = {}) {
  const calls = [];
  let ipc = 0;
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname;
    calls.push([init.method ?? "GET", route, init.body ? JSON.parse(init.body) : undefined]);
    const json = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if (route === "/health") return healthOk ? json({ status: "ok" }) : json({}, 503);
    if (route === "/navigate") {
      ipc += 3;
      return json({ success: true });
    }
    if (route === "/perf/mark") return json({ success: true });
    if (route === "/perf/snapshot") return snapshot ? json({ ipc: { totalCount: ipc } }) : json({ error: "no perf" }, 500);
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

const REG = "export const NAV_SECTIONS: readonly NavSectionEntry[] = [\n  { id: 'home', label: 'Home', gates: {}, reachability: 'sidebar' },\n  { id: 'studio', label: 'S', gates: { devOnly: true }, reachability: 'nested', parent: 'teams' },\n  { id: 'schedules', label: 'X', gates: {}, reachability: 'overlay-only' },\n] as const;\n";

test("walk: unreachable server prints the start hint and exits 2", async () => {
  const lines = [];
  const { fetchImpl } = fakeServer({ healthOk: false });
  const r = await runWalk({ port: 17320, logsDir: tmp("devlog-walk-"), fetchImpl, print: (l) => lines.push(l), registrySource: REG });
  assert.equal(r.exitCode, 2);
  assert.deepEqual(lines, ["walk: test-automation server not reachable on :17320 - start npm run tauri:dev:test"]);
});

test("walk: marks, navigates and settles each visitable section, records the walk", async () => {
  const logs = tmp("devlog-walk-");
  let clock = 0;
  const realNow = Date.now;
  Date.now = () => realNow() + clock;
  try {
    const { fetchImpl, calls } = fakeServer();
    const r = await runWalk({ port: 1, logsDir: logs, fetchImpl, print: () => {}, registrySource: REG, sleep: async (ms) => (clock += ms), walkId: "walk-test" });
    assert.equal(r.exitCode, 0);
    const nav = calls.filter((c) => c[1] === "/navigate").map((c) => c[2].section);
    assert.deepEqual(nav, ["home", "studio"], "overlay-only sections are skipped");
    const marks = calls.filter((c) => c[1] === "/perf/mark").map((c) => c[2].label);
    assert.deepEqual(marks, ["devlog:walk-test:home:start", "devlog:walk-test:home:end", "devlog:walk-test:studio:start", "devlog:walk-test:studio:end"]);
  } finally {
    Date.now = realNow;
  }
  const recs = readJsonl(logs);
  assert.deepEqual(recs.map((x) => x.msg), ["walk.start", "walk.section", "walk.section", "walk.end"]);
  assert.ok(recs.every((x) => x.f.walk_id === "walk-test" && x.tgt === "devlog"));
  assert.equal(recs[1].f.settle, "ipc-stable");
  assert.equal(recs[1].f.settled, true);

  const logs2 = tmp("devlog-walk-");
  const { fetchImpl } = fakeServer({ snapshot: false });
  await runWalk({ port: 1, logsDir: logs2, fetchImpl, print: () => {}, registrySource: REG, sleep: async () => {}, walkId: "walk-fixed" });
  assert.equal(readJsonl(logs2)[1].f.settle, "fixed-2500ms");
});
