#!/usr/bin/env node
/**
 * cinema-timing-harness.mjs — measure the real persona-build event timeline
 * behind the Cinema loading experience.
 *
 * For each scenario in cinema-scenarios.json, it drives the running app
 * (test-automation bridge on :17320) to launch a build from the intent, then
 * polls getState() until the first clarifying question (or terminal phase /
 * timeout), timestamping when each intermediate signal first lands:
 *
 *   analyzing -> behaviorCore (identity) -> capabilities -> connectors ->
 *   resolved cells -> first question
 *
 * The output (cinema-timing-results.json) tells us:
 *   - how long the first "dead" wait really is per complexity,
 *   - whether the identity/capabilities/connectors stream early enough to
 *     ground the cinema's casting (30s) and capability acts, or arrive in a
 *     late burst near the first question,
 * so we can tune the cinema's phase durations to reality instead of guessing.
 *
 * Requires the app running with `npm run tauri:dev:test` (bridge on :17320).
 *
 * Usage:
 *   node tools/test-mcp/cinema-timing-harness.mjs             # all scenarios
 *   node tools/test-mcp/cinema-timing-harness.mjs s03 s10     # a subset by id prefix
 *   POLL_MS=1000 MAX_MS=200000 node tools/test-mcp/cinema-timing-harness.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = process.env.BRIDGE || "http://127.0.0.1:17320";
const POLL_MS = Number(process.env.POLL_MS || 1200);
const MAX_MS = Number(process.env.MAX_MS || 180000); // 3 min per scenario ceiling
const LAUNCH_TIMEOUT = Number(process.env.LAUNCH_TIMEOUT || 40000);

const TERMINAL = new Set(["awaiting_input", "draft_ready", "testing", "test_complete", "promoted", "failed"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bridgeExec(method, params = {}, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE}/bridge-exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text, _status: res.status };
    }
  } finally {
    clearTimeout(t);
  }
}

async function getState(timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE}/state`, { signal: ctrl.signal });
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function ping() {
  const s = await getState(6000);
  return s !== null;
}

async function enterDescribeCinema() {
  // The create surface opens on a mode chooser (Compose vs "Describe it").
  // startBuildFromIntent probes the intent input directly and can't get past
  // the chooser, so we must click "Describe it" first — which also reveals the
  // layout toggles. Selecting Cinema (localStorage-persisted) lets the operator
  // watch the loading experience against the measured timeline. Idempotent —
  // run before every scenario so a prior build's reset can't strand us.
  await bridgeExec("startCreateAgent", {}).catch(() => {});
  await sleep(500);
  await bridgeExec("clickTestId", { testId: "create-mode-describe" }).catch(() => {});
  await sleep(400);
  await bridgeExec("clickTestId", { testId: "build-layout-toggle-cinema" }).catch(() => {});
  await sleep(300);
}

function firstSeen(marks, key, elapsed) {
  if (marks[key] == null) marks[key] = elapsed;
}

async function runScenario(sc) {
  console.log(`\n▶ ${sc.id} — ${sc.title}  [${sc.complexity}]`);
  console.log(`  intent: ${sc.intent}`);

  await enterDescribeCinema(); // get past the mode chooser into Describe/Cinema
  const launch = await bridgeExec("startBuildFromIntent", { intent: sc.intent, timeoutMs: LAUNCH_TIMEOUT }, LAUNCH_TIMEOUT + 8000);
  const t0 = Date.now();
  if (!launch?.success) {
    console.log(`  ✗ launch failed: ${launch?.error || JSON.stringify(launch)}`);
    return { ...scMeta(sc), ok: false, error: launch?.error || "launch failed", launch };
  }
  const sessionId = launch.sessionId || null;
  console.log(`  ✓ launched session=${sessionId} phase=${launch.phase}`);

  const marks = {}; // milestone -> elapsed ms
  const timeline = []; // sampled snapshots
  let capMax = 0, connMax = 0, cellMax = 0, role = null, mission = null;
  let capTitles = [], connectors = [], pendingCells = [];
  let lastPhase = launch.phase || null;
  let stopReason = "timeout";

  while (Date.now() - t0 < MAX_MS) {
    await sleep(POLL_MS);
    const s = await getState();
    const elapsed = Date.now() - t0;
    if (!s) {
      timeline.push({ t: elapsed, phase: "(no-state)" });
      continue;
    }
    const phase = s.buildPhase ?? null;
    const caps = s.buildCapabilityCount ?? 0;
    const conns = s.buildConnectorCount ?? 0;
    const cells = s.buildResolvedCellCount ?? 0;
    const pending = s.buildPendingCount ?? 0;

    if (phase === "analyzing") firstSeen(marks, "analyzing", elapsed);
    if (phase === "resolving") firstSeen(marks, "resolving", elapsed);
    if (s.buildHasCore) { firstSeen(marks, "core", elapsed); role = s.buildRole ?? role; }
    if (caps >= 1) firstSeen(marks, "firstCapability", elapsed);
    if (caps > capMax) { capMax = caps; marks.lastCapabilityGrowth = elapsed; capTitles = s.buildCapabilityTitles ?? capTitles; }
    if (conns >= 1) firstSeen(marks, "firstConnector", elapsed);
    if (conns > connMax) { connMax = conns; marks.lastConnectorGrowth = elapsed; connectors = s.buildConnectors ?? connectors; }
    if (cells > cellMax) { cellMax = cells; marks.lastCellResolve = elapsed; }
    if (pending >= 1) { firstSeen(marks, "firstQuestion", elapsed); pendingCells = s.buildPendingCells ?? pendingCells; }
    if (s.buildMission) mission = s.buildMission;

    if (phase !== lastPhase) {
      console.log(`    ${(elapsed / 1000).toFixed(1)}s  phase=${phase}  core=${s.buildHasCore ? "Y" : "-"} caps=${caps} conns=${conns} cells=${cells} q=${pending}`);
      lastPhase = phase;
    }
    timeline.push({ t: elapsed, phase, core: !!s.buildHasCore, caps, conns, cells, pending });

    if (pending >= 1) { stopReason = "first-question"; break; }
    if (phase && TERMINAL.has(phase)) { stopReason = `terminal:${phase}`; break; }
    if (phase === "failed" || s.buildError) { stopReason = "error"; break; }
  }

  const total = Date.now() - t0;
  console.log(`  ■ stop=${stopReason} @ ${(total / 1000).toFixed(1)}s  | core@${fmt(marks.core)} caps@${fmt(marks.firstCapability)} conns@${fmt(marks.firstConnector)} Q@${fmt(marks.firstQuestion)}  caps=${capMax} conns=${connMax}`);

  // Clean up so the next scenario's CLI process doesn't pile up.
  if (sessionId) await bridgeExec("invokeCommand", { command: "cancel_build_session", params: { sessionId } }).catch(() => {});
  await bridgeExec("__reset__", {}).catch(() => {});
  await sleep(1500);

  return {
    ...scMeta(sc),
    ok: true,
    sessionId,
    stopReason,
    totalMs: total,
    marks,
    capabilityCount: capMax,
    connectorCount: connMax,
    resolvedCells: cellMax,
    role,
    mission,
    capabilityTitles: capTitles,
    connectors,
    pendingCells,
    timeline,
  };
}

const fmt = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
const scMeta = (sc) => ({ id: sc.id, title: sc.title, complexity: sc.complexity, intent: sc.intent, expectedTools: sc.expectedTools });

function summarize(results) {
  console.log(`\n${"═".repeat(96)}\nSUMMARY (elapsed from launch)\n${"═".repeat(96)}`);
  const H = ["id", "cx", "core", "cap1", "capN", "conn1", "Q(first)", "caps", "conns", "stop"];
  console.log(H.map((h, i) => h.padEnd([14, 10, 7, 7, 7, 7, 9, 5, 6, 16][i])).join(""));
  for (const r of results) {
    if (!r.ok) { console.log(`${r.id.padEnd(14)}${(r.complexity || "").padEnd(10)}FAILED: ${r.error}`); continue; }
    const m = r.marks;
    const row = [
      r.id.padEnd(14),
      (r.complexity || "").padEnd(10),
      fmt(m.core).padEnd(7),
      fmt(m.firstCapability).padEnd(7),
      fmt(m.lastCapabilityGrowth).padEnd(7),
      fmt(m.firstConnector).padEnd(7),
      fmt(m.firstQuestion).padEnd(9),
      String(r.capabilityCount).padEnd(5),
      String(r.connectorCount).padEnd(6),
      (r.stopReason || "").padEnd(16),
    ];
    console.log(row.join(""));
  }
  // Aggregate read
  const done = results.filter((r) => r.ok && r.marks.firstQuestion != null);
  if (done.length) {
    const avg = (k) => (done.reduce((a, r) => a + (r.marks[k] ?? 0), 0) / done.length / 1000).toFixed(1);
    console.log(`\navg core@${avg("core")}s  cap1@${avg("firstCapability")}s  conn1@${avg("firstConnector")}s  firstQ@${avg("firstQuestion")}s  (n=${done.length})`);
  }
}

async function main() {
  const filters = process.argv.slice(2);
  const { scenarios } = JSON.parse(readFileSync(join(HERE, "cinema-scenarios.json"), "utf8"));
  const chosen = filters.length ? scenarios.filter((s) => filters.some((f) => s.id.startsWith(f) || s.id.includes(f))) : scenarios;
  if (!chosen.length) { console.error("No scenarios matched:", filters); process.exit(1); }

  if (!(await ping())) {
    console.error(`\n✗ Bridge not responding at ${BRIDGE}. Start the app with:  npm run tauri:dev:test\n  (vite :1420 + test-automation :17320 must both be up)`);
    process.exit(2);
  }
  console.log(`Bridge OK. Running ${chosen.length} scenario(s), poll=${POLL_MS}ms, ceiling=${MAX_MS / 1000}s each.`);

  const results = [];
  for (const sc of chosen) {
    try {
      results.push(await runScenario(sc));
    } catch (e) {
      console.log(`  ✗ ${sc.id} threw: ${e.message}`);
      results.push({ ...scMeta(sc), ok: false, error: e.message });
    }
  }

  const out = { generatedAt: new Date().toISOString(), bridge: BRIDGE, pollMs: POLL_MS, results };
  const outPath = join(HERE, "cinema-timing-results.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  summarize(results);
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
