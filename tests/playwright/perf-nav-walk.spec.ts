import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Performance nav-walk: visits every reachable navigation stop in the app,
 * captures render + IPC metrics per stop, and writes a structured JSON
 * report under `docs/harness/perf-runs/`.
 *
 * The goal is to replace the audit-time finding catalogue (subagent
 * estimates) with real measurements: when we have the actual render and
 * IPC counts per surface, we know which Pipeline-B wave findings are real
 * cost drivers vs. theoretical concerns.
 *
 * Pre-req:
 *   npm run tauri:dev:test   (or tauri:dev:test:full)
 *   Expects window.__TEST__ + window.__PERF__ live on port 17320.
 *
 * Run:
 *   npx playwright test tests/playwright/perf-nav-walk.spec.ts
 *
 * Output:
 *   docs/harness/perf-runs/<ISO-timestamp>.json   (meta.schemaVersion 2)
 *
 * Extending: add entries to the STOPS array below. Each stop is a label +
 * an async function that drives the app into a state. The framework
 * handles reset / wait-idle / snapshot per stop.
 *
 * ── WHAT A ROW DOES AND DOES NOT MEAN ─────────────────────────────────────
 *
 * This walk produced a FALSE RANKING that a design campaign acted on, twice
 * over, and the three fields that would have exposed it did not exist. They do
 * now; read them before ranking anything:
 *
 *   `status`          — 'failed' rows have `perf: null`. They are not
 *                       measurements. (Schema 1 copied a neighbouring snapshot
 *                       into them instead: 6 of 30 rows in the 2026-09-24T10-08
 *                       run are duplicates presented as measurements.)
 *   `settle.settled`  — false means the settle loop hit its 8s ceiling with IPC
 *                       still arriving. `perf.durationMs` on such a row is the
 *                       harness's own ceiling. This is what made `twin/profiles`
 *                       read as a 10.2s surface whose own IPC totalled 88.9ms.
 *   `firstOnPageLoad` — true means the webview had just reloaded and this stop
 *                       absorbed the app's bootstrap IPC.
 *
 * And `perf.durationMs` is a WINDOW LENGTH, never a surface cost: subtract
 * `timing.harnessMs`. Measured on the first schema-2 run
 * (`2026-10-03T01-03-04-081Z.json`): summed over 30 stops, `durationMs` is
 * 37,554.7 ms and `harnessMs` is 37,492 ms — **99.8% of it is this file**. The
 * costs that belong to the app are `perf.ipc.totalDurationMs`,
 * `perf.render.totalActualDurationMs` and `perf.longTasks`.
 *
 * KNOWN-BAD DATA. `docs/harness/perf-runs/2026-09-24T10-08-09-822Z.json`
 * (schema 1) must not be used to rank surfaces: 6 of its 30 rows are identical
 * copies of the pre-walk probe, its bridge was dying from `settings/engine`
 * onward, and its two apparent worst surfaces are both post-reload artefacts.
 * `docs/harness/perf-runs/README.md` has the itemised account — note that the
 * perf-runs directory is GITIGNORED (`.gitignore:245`), so no run JSON is
 * tracked and those files live only in a local working tree.
 */

const BASE = `http://127.0.0.1:${process.env.COMPANION_TEST_PORT ?? 17320}`;

/**
 * The subset of `src/test/automation/perfInstrument.ts`'s `PerfSnapshot` that
 * this walk reads. Deliberately a subset — the instrument also reports frames,
 * long tasks, memory and event arrivals, which the walk records verbatim
 * without interpreting.
 */
interface PerfSnapshot {
  /** See perfInstrument's `PerfSnapshot.pageLoad`. Optional so an OLD build of
   *  the app (pre-page-load-id) still produces a readable report instead of
   *  crashing the walk; `pageLoadIdAvailable` in the report meta records which
   *  it was. */
  pageLoad?: { id: string; timeOrigin: number; resetSeq: number };
  resetAt?: number;
  snapshotAt?: number;
  /** Window LENGTH, not surface cost — it contains this walk's own setup and
   *  settle loop. Use `timing` on the stop row to subtract them. */
  durationMs: number;
  marks: Array<{ label: string; tMs: number }>;
  ipc: {
    totalCount: number;
    totalDurationMs: number;
    byCommand: Array<{ command: string; count: number; totalMs: number; avgMs: number }>;
  };
  render: {
    commitCount: number;
    totalActualDurationMs: number;
    totalBaseDurationMs: number;
    avgActualMs: number;
  };
  dom: { nodeCount: number };
  diagnostics?: { ipcSubscribed?: boolean };
}

async function postRaw(p: string, body: unknown = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${p} → ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function getRaw<T = unknown>(p: string): Promise<T> {
  const res = await fetch(`${BASE}${p}`);
  if (!res.ok) {
    throw new Error(`GET ${p} → ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

/** Eval a named method on window.__TEST__ via /bridge-exec. */
async function bridgeExec(method: string, params: Record<string, unknown> = {}, timeoutSecs = 30): Promise<unknown> {
  const raw = await postRaw('/bridge-exec', { method, params, timeout_secs: timeoutSecs });
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

async function resetPerf(): Promise<void> { await postRaw('/perf/reset'); }
async function snapshotPerf(): Promise<PerfSnapshot> { return getRaw<PerfSnapshot>('/perf/snapshot'); }
/** Phase marker — unused by the default stops but exposed for future per-stop sub-phase slicing. */
async function _markPerf(label: string): Promise<void> { await postRaw('/perf/mark', { label }); }
async function navigate(section: string): Promise<unknown> { return postRaw('/navigate', { section }); }

const SETTLE_STABLE_MS = 600;
const SETTLE_MAX_MS = 8_000;

/**
 * What a settle attempt actually did. The whole point of this type is that
 * `settled: false` is REPRESENTABLE.
 *
 * Until 2026-10-03 `waitForIdle` returned `void` and returned it both when the
 * IPC count went quiet and when it hit its own deadline. A surface that never
 * settled was therefore indistinguishable from one that settled instantly, and
 * because `perf.durationMs` spans the whole loop, a never-settling stop read as
 * an ~8s surface. That is how `twin/profiles` was reported at 10,264 ms in
 * `docs/harness/perf-runs/2026-09-24T10-08-09-822Z.json` while its own 4 IPC
 * calls totalled 88.9 ms — ~7.3 s of the "gap" was this loop at its ceiling,
 * and the apparent 4x worst surface in the app did not exist.
 */
interface SettleResult {
  /**
   * True -> `ipc.totalCount` stopped moving for `stableMs` and the window is a
   * real quiet-state measurement. False -> the deadline expired with IPC still
   * arriving; the window was CUT SHORT, every duration on the row is bounded by
   * the harness rather than by the app, and the row is not comparable with a
   * settled one.
   */
  settled: boolean;
  /** Wall-clock ms spent inside this loop, deadline included. */
  waitedMs: number;
  /** Snapshot polls issued. Each is an HTTP round-trip to the bridge. */
  polls: number;
  /** `ipc.totalCount` as last observed. */
  lastIpcCount: number;
  stableMs: number;
  maxMs: number;
}

/** Wait until IPC count is stable for `stableMs`, or `maxMs` elapses. */
async function waitForIdle(stableMs = SETTLE_STABLE_MS, maxMs = SETTLE_MAX_MS): Promise<SettleResult> {
  const startedAt = Date.now();
  const deadline = startedAt + maxMs;
  let lastCount = -1;
  let lastChangeAt = Date.now();
  let polls = 0;
  const done = (settled: boolean): SettleResult => ({
    settled,
    waitedMs: Date.now() - startedAt,
    polls,
    lastIpcCount: lastCount,
    stableMs,
    maxMs,
  });
  // Initial settle delay so the first navigate has a chance to kick off
  // its work before we start polling.
  await new Promise((r) => setTimeout(r, 100));
  while (Date.now() < deadline) {
    const snap = await snapshotPerf();
    polls += 1;
    if (snap.ipc.totalCount !== lastCount) {
      lastCount = snap.ipc.totalCount;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= stableMs) {
      return done(true);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  // Deadline reached with traffic still arriving. NOT silent: the caller gets
  // `settled: false` and it reaches the written JSON.
  return done(false);
}

// ── Stop catalogue ──────────────────────────────────────────────────────────
// Add entries here to grow coverage. Each stop should leave the app in a
// distinct, observable state — duplicates inflate the report without adding
// signal. Use the L1 navigate path then any sub-nav setter the bridge exposes.

interface NavStop {
  id: string;
  group: string;
  description: string;
  setup: () => Promise<unknown>;
}

const STOPS: NavStop[] = [
  // L1 sections (sidebar top-level)
  { id: 'L1/home',            group: 'L1', description: 'Home dashboard',         setup: () => navigate('home') },
  { id: 'L1/overview',        group: 'L1', description: 'Overview dashboard',     setup: () => navigate('overview') },
  { id: 'L1/teams',           group: 'L1', description: 'Teams workspace',        setup: () => navigate('teams') },
  { id: 'L1/personas',        group: 'L1', description: 'Personas list',          setup: () => navigate('personas') },
  { id: 'L1/events',          group: 'L1', description: 'Events / Triggers',      setup: () => navigate('events') },
  { id: 'L1/credentials',     group: 'L1', description: 'Credentials vault',      setup: () => navigate('credentials') },
  { id: 'L1/design-reviews',  group: 'L1', description: 'Templates / recipes',    setup: () => navigate('design-reviews') },
  { id: 'L1/plugins',         group: 'L1', description: 'Plugins (browse)',       setup: () => navigate('plugins') },
  { id: 'L1/settings',        group: 'L1', description: 'Settings (default tab)', setup: () => navigate('settings') },

  // Plugin tabs (setPluginTab + navigate('plugins'))
  { id: 'plugins/browse',         group: 'plugins', description: 'Plugin browse page',         setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'browse' }); } },
  { id: 'plugins/dev-tools',      group: 'plugins', description: 'Dev tools plugin',           setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'dev-tools' }); } },
  { id: 'plugins/obsidian-brain', group: 'plugins', description: 'Obsidian Brain plugin',      setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'obsidian-brain' }); } },
  { id: 'plugins/drive',          group: 'plugins', description: 'Drive plugin',               setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'drive' }); } },
  { id: 'plugins/twin',           group: 'plugins', description: 'Twin plugin',                setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); } },

  // Settings tabs (openSettingsTab)
  { id: 'settings/account',       group: 'settings', description: 'Settings → Account',       setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'account' }); } },
  { id: 'settings/appearance',    group: 'settings', description: 'Settings → Appearance',    setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'appearance' }); } },
  { id: 'settings/notifications', group: 'settings', description: 'Settings → Notifications', setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'notifications' }); } },
  { id: 'settings/engine',        group: 'settings', description: 'Settings → Engine',        setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'engine' }); } },
  { id: 'settings/byom',          group: 'settings', description: 'Settings → BYOM',          setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'byom' }); } },
  { id: 'settings/portability',   group: 'settings', description: 'Settings → Portability',   setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'portability' }); } },
  { id: 'settings/limits',        group: 'settings', description: 'Settings → Limits',        setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'limits' }); } },
  { id: 'settings/api-keys',      group: 'settings', description: 'Settings → API Keys',      setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'api-keys' }); } },
  { id: 'settings/config',        group: 'settings', description: 'Settings → Config',        setup: async () => { await navigate('settings'); await bridgeExec('openSettingsTab', { tab: 'config' }); } },

  // Twin sub-tabs (when twin plugin is active)
  { id: 'twin/profiles',  group: 'twin', description: 'Twin → Profiles',  setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'profiles' }); } },
  { id: 'twin/setup',     group: 'twin', description: 'Twin → Setup',     setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'setup' }); } },
  { id: 'twin/hub',       group: 'twin', description: 'Twin → Hub',       setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'hub' }); } },

  // Re-visit stops — measure the impact of Tier-1 cache/TTL fixes.
  // A second mount of the same page should hit the in-memory caches
  // (rotation-status cache, healthcheck TTL, config cache) and fire far
  // fewer IPCs than the cold-land measurement.
  { id: 'revisit/credentials-2nd', group: 'revisit', description: 'Credentials, second visit', setup: async () => { await navigate('home'); await new Promise(r => setTimeout(r, 200)); await navigate('credentials'); } },
  { id: 'revisit/overview-2nd',    group: 'revisit', description: 'Overview, second visit',    setup: async () => { await navigate('home'); await new Promise(r => setTimeout(r, 200)); await navigate('overview'); } },
  { id: 'revisit/settings-2nd',    group: 'revisit', description: 'Settings, second visit',    setup: async () => { await navigate('home'); await new Promise(r => setTimeout(r, 200)); await navigate('settings'); } },

  // Interaction stop — sustained live-event traffic via the test bridge's
  // triggerTestFlow(), which fans 4 simulated events through the event bus
  // over ~1.5s. Exercises the Wave 2A rAF coalescing in
  // createSingletonListener + useRealtimeEvents downstream.
  { id: 'interaction/live-events-burst', group: 'interaction', description: 'Realtime burst on Events tab', setup: async () => {
    await navigate('events');
    await new Promise(r => setTimeout(r, 400));
    await bridgeExec('triggerTestFlow', {});
    // Let the burst land; wait-for-idle finishes the rest.
    await new Promise(r => setTimeout(r, 1500));
  } },
];

// ── Ambient IPC ─────────────────────────────────────────────────────────────

/**
 * Commands that fire on a WALL-CLOCK TIMER, not because of the surface under
 * measurement. They land in whichever stop's window happens to be open, so a
 * reader comparing two stops' `ipc.totalCount` is partly comparing how long
 * each window was.
 *
 * This is deliberately the cheap, honest move and not an attribution model: the
 * instrument already reports `ipc.byCommand`, so all that was missing was a
 * NAMED list of which of those commands are ambient plus the derived split. A
 * real model would need call-site provenance (which component invoked it),
 * which the IPC metrics bus does not carry.
 *
 * Neither entry is a defect — both are deliberate product behaviour, cited here
 * so nobody "fixes" them off the back of a perf report.
 */
const AMBIENT_COMMANDS: Array<{ command: string; everyMs: number; source: string; why: string }> = [
  {
    command: 'get_system_metrics',
    everyMs: 2_000,
    source: 'src/features/shared/chrome/SystemLoadFooterIcon.tsx:19',
    why: 'Footer CPU/RAM gauge polls every ~2s while the window is visible. POLL_MS = 2000.',
  },
  {
    command: 'list_team_channel',
    everyMs: 7_500,
    source: 'src/features/fleet/monitor/grid/rail/useRailFeeds.ts:34',
    why: 'Channel feed subscription is refcounted and stays subscribed with the Monitor closed; measured 8x/60s on the live app (2026-09-01).',
  },
];
const AMBIENT_SET = new Set(AMBIENT_COMMANDS.map((a) => a.command));

/** Split a snapshot's per-command IPC into the surface's own calls and ambient
 *  timer traffic. Pure arithmetic over `byCommand` — no new measurement. */
function splitIpc(perf: PerfSnapshot): StopIpcSplit {
  let ownCount = 0;
  let ownMs = 0;
  let ambientCount = 0;
  let ambientMs = 0;
  for (const c of perf.ipc.byCommand) {
    if (AMBIENT_SET.has(c.command)) {
      ambientCount += c.count;
      ambientMs += c.totalMs;
    } else {
      ownCount += c.count;
      ownMs += c.totalMs;
    }
  }
  return {
    ownCount,
    ownDurationMs: Math.round(ownMs * 100) / 100,
    ambientCount,
    ambientDurationMs: Math.round(ambientMs * 100) / 100,
  };
}

// ── Report writer ───────────────────────────────────────────────────────────

interface StopIpcSplit {
  /** IPC calls that are not on the ambient list — the closest thing to "this
   *  surface's own work" this instrument can honestly report. */
  ownCount: number;
  ownDurationMs: number;
  /** Calls attributable to a wall-clock poll that would have happened anyway. */
  ambientCount: number;
  ambientDurationMs: number;
}

/** How much of a stop's window belonged to the harness rather than the app. */
interface StopTiming {
  /** Wall-clock ms inside `stop.setup()` — navigate + bridge calls. */
  setupMs: number;
  /** Wall-clock ms inside `waitForIdle()`. On an unsettled stop this is its
   *  ceiling (`SETTLE_MAX_MS`), which is the single biggest term in
   *  `perf.durationMs`. */
  settleMs: number;
  /** `setupMs + settleMs`. Subtract from `perf.durationMs` to see what is
   *  left over; the residual is the snapshot round-trip, not a surface stall. */
  harnessMs: number;
}

/**
 * One row. A row is EITHER a measurement or a failure, and the two are not the
 * same shape.
 *
 * Until 2026-10-03 `perf` was pre-assigned outside the try block, so a stop
 * whose setup threw silently recorded the pre-walk probe snapshot under its own
 * name — six of thirty rows in
 * `docs/harness/perf-runs/2026-09-24T10-08-09-822Z.json` are byte-identical
 * copies of the probe (all carrying `resetAt=7234.0999`), presented as
 * measurements of six different surfaces. `perf: null` plus an explicit
 * `status` makes that unrepresentable: a failed stop cannot be averaged in
 * with real ones by accident.
 */
interface StopResult {
  stop: { id: string; group: string; description: string };
  /** 'measured' -> `perf` is a real snapshot of THIS stop's window.
   *  'failed'   -> setup or snapshot threw; `perf` is null and there is no
   *                measurement for this stop. Do not substitute anything. */
  status: 'measured' | 'failed';
  /** Null exactly when `status === 'failed'`. */
  perf: PerfSnapshot | null;
  /** Null exactly when `status === 'failed'` (the stop never reached a settle). */
  settle: SettleResult | null;
  timing: StopTiming | null;
  /**
   * True -> this stop is the first measured window on its page load
   * (`perf.pageLoad.resetSeq === 1`), so it absorbed the app's bootstrap IPC
   * and its counts are NOT this surface's cost. Null when the app build did
   * not report `pageLoad`.
   */
  firstOnPageLoad: boolean | null;
  /** True -> the webview re-loaded (or the instrument re-evaluated) between the
   *  previous stop and this one, which re-based `resetAt`/`snapshotAt` to a new
   *  zero. Cross-stop timestamp comparisons do not hold across this boundary. */
  pageLoadChangedSincePrevious: boolean | null;
  ipcSplit: StopIpcSplit | null;
  setupError?: string;
}

interface RunReport {
  meta: {
    /** 1 = the pre-2026-10-03 shape: `perf` always present (possibly a stale
     *  copy), no settle flag, no page-load id. 2 = this shape. */
    schemaVersion: 2;
    timestamp: string;
    bridgeUrl: string;
    stopCount: number;
    gitHead?: string;
    settle: { stableMs: number; maxMs: number };
    ambientCommands: typeof AMBIENT_COMMANDS;
    /** False -> the app build under test predates `PerfSnapshot.pageLoad`, so
     *  every `firstOnPageLoad` / `pageLoadChangedSincePrevious` is null and a
     *  mid-walk reload is undetectable in this run. */
    pageLoadIdAvailable: boolean;
    /** Statements about what the numbers mean, carried IN the artefact. The
     *  2026-09-24 runs were misread because nothing in the file said any of
     *  this. */
    notes: string[];
  };
  summary: {
    measured: number;
    failed: number;
    /** Rows where the settle loop hit its deadline. Their durations are
     *  harness ceilings; exclude them before ranking surfaces. */
    unsettled: string[];
    /** Rows that absorbed an app bootstrap. Same warning. */
    firstOnPageLoad: string[];
    /** Distinct page loads seen, in first-seen order. More than one means the
     *  webview reloaded mid-walk. */
    pageLoads: string[];
  };
  stops: StopResult[];
}

function repoRoot(): string {
  // tests/playwright/perf-nav-walk.spec.ts → ../../../ → repo root.
  // Playwright runs specs as ESM where __dirname is undefined, so derive
  // from the spec's own location via import.meta.url.
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  return path.resolve(here, '..', '..');
}

function reportPath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(repoRoot(), 'docs', 'harness', 'perf-runs', `${ts}.json`);
}

function writeReport(report: RunReport): string {
  const out = reportPath();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  return out;
}

// ── Test ────────────────────────────────────────────────────────────────────

test.describe('perf-nav-walk', () => {
  test.setTimeout(STOPS.length * 30_000 + 60_000);

  test('walks every nav stop and writes a perf JSON report', async () => {
    // Sanity-check the bridge + __PERF__ are alive before doing any work.
    const health = await getRaw<{ status: string }>('/health');
    expect(health.status).toBe('ok');
    const probe = await snapshotPerf();
    expect(typeof probe.ipc.totalCount).toBe('number');
    // The hard guarantee we need is that perfInstrument subscribed to the
    // IPC metrics bus. If it didn't, every stop reads 0 IPCs which would be
    // a silent measurement bug. A given navigate() may legitimately fire
    // zero new IPCs (cache hit, no-op transition), so we don't gate on
    // that count being > 0.
    expect(probe.diagnostics?.ipcSubscribed).toBe(true);

    const results: StopResult[] = [];
    let previousPageLoadId: string | null = null;
    const pageLoadsSeen: string[] = [];

    for (const stop of STOPS) {
      // A row starts as a FAILURE and is only promoted to a measurement once a
      // snapshot of this stop's own window exists. Nothing from a previous stop
      // (or from the pre-walk probe) is ever allowed to stand in for it.
      const stopResult: StopResult = {
        stop: { id: stop.id, group: stop.group, description: stop.description },
        status: 'failed',
        perf: null,
        settle: null,
        timing: null,
        firstOnPageLoad: null,
        pageLoadChangedSincePrevious: null,
        ipcSplit: null,
      };
      try {
        await resetPerf();
        const setupStartedAt = Date.now();
        await stop.setup();
        const setupMs = Date.now() - setupStartedAt;
        const settle = await waitForIdle();
        const perf = await snapshotPerf();

        const pageLoadId = perf.pageLoad?.id ?? null;
        if (pageLoadId && !pageLoadsSeen.includes(pageLoadId)) pageLoadsSeen.push(pageLoadId);

        stopResult.status = 'measured';
        stopResult.perf = perf;
        stopResult.settle = settle;
        stopResult.timing = {
          setupMs,
          settleMs: settle.waitedMs,
          harnessMs: setupMs + settle.waitedMs,
        };
        stopResult.firstOnPageLoad =
          perf.pageLoad ? perf.pageLoad.resetSeq === 1 : null;
        stopResult.pageLoadChangedSincePrevious =
          pageLoadId === null ? null : previousPageLoadId !== null && pageLoadId !== previousPageLoadId;
        stopResult.ipcSplit = splitIpc(perf);
        if (pageLoadId) previousPageLoadId = pageLoadId;

        const flags = [
          settle.settled ? '' : 'UNSETTLED',
          stopResult.firstOnPageLoad ? 'POST-RELOAD(bootstrap)' : '',
          stopResult.pageLoadChangedSincePrevious ? 'NEW-PAGE-LOAD' : '',
        ].filter(Boolean).join(' ');
        console.log(
          `[${stop.id.padEnd(30)}] renders=${perf.render.commitCount.toString().padStart(3)} ` +
          `ipc=${perf.ipc.totalCount.toString().padStart(3)} ` +
          `(own=${stopResult.ipcSplit.ownCount.toString().padStart(3)} ambient=${stopResult.ipcSplit.ambientCount.toString().padStart(2)}) ` +
          `actualMs=${perf.render.totalActualDurationMs.toFixed(1).padStart(6)} ` +
          `dom=${perf.dom.nodeCount.toString().padStart(5)} ` +
          `harnessMs=${stopResult.timing.harnessMs.toString().padStart(5)} ${flags}`,
        );
      } catch (err) {
        // Leaves status='failed' and perf=null. There is no measurement for
        // this stop and the report must not pretend otherwise.
        stopResult.setupError = err instanceof Error ? err.message : String(err);
        console.warn(`[${stop.id}] FAILED (no measurement recorded): ${stopResult.setupError}`);
      }
      results.push(stopResult);
    }

    const measured = results.filter((r) => r.status === 'measured');
    const report: RunReport = {
      meta: {
        schemaVersion: 2,
        timestamp: new Date().toISOString(),
        bridgeUrl: BASE,
        stopCount: STOPS.length,
        settle: { stableMs: SETTLE_STABLE_MS, maxMs: SETTLE_MAX_MS },
        ambientCommands: AMBIENT_COMMANDS,
        pageLoadIdAvailable: measured.some((r) => r.perf?.pageLoad != null),
        notes: [
          'perf.durationMs is the measurement WINDOW length, not a surface cost. It contains timing.setupMs and timing.settleMs; subtract timing.harnessMs before reading anything into it.',
          `The settle loop has a floor of roughly ${SETTLE_STABLE_MS + 150}ms (a stop with zero IPC still waits for stability) and a ceiling of ${SETTLE_MAX_MS}ms. A stop with settle.settled === false hit that ceiling and its window was cut short by the harness, not by the app.`,
          'A stop with status === "failed" has perf === null. There is no measurement for it. Do not substitute a neighbouring row (schemaVersion 1 runs did exactly that, silently).',
          'A stop with firstOnPageLoad === true absorbed the app bootstrap on a fresh page-load timeline (companion_init, radio_*, fleet_set_*, seed/import commands). Its IPC counts are the app booting, not the surface working.',
          'resetAt / snapshotAt are page-relative (performance.now()). They are only comparable between stops that share perf.pageLoad.id.',
          'ipcSplit separates meta.ambientCommands (wall-clock polls that fire regardless of the surface) from everything else. It is a named-list split, not a provenance model: an ambient command that a surface genuinely calls on mount would be mis-filed as ambient.',
        ],
      },
      summary: {
        measured: measured.length,
        failed: results.length - measured.length,
        unsettled: measured.filter((r) => r.settle && !r.settle.settled).map((r) => r.stop.id),
        firstOnPageLoad: measured.filter((r) => r.firstOnPageLoad).map((r) => r.stop.id),
        pageLoads: pageLoadsSeen,
      },
      stops: results,
    };
    const out = writeReport(report);
    console.log(
      `\nmeasured=${report.summary.measured} failed=${report.summary.failed} ` +
      `unsettled=${report.summary.unsettled.length} ` +
      `postReload=${report.summary.firstOnPageLoad.length} ` +
      `pageLoads=${report.summary.pageLoads.length}`,
    );
    if (report.summary.unsettled.length > 0) {
      console.warn(
        `[perf-nav-walk] ${report.summary.unsettled.length} stop(s) never settled — their durations are the ` +
        `${SETTLE_MAX_MS}ms harness ceiling, not surface cost: ${report.summary.unsettled.join(', ')}`,
      );
    }
    if (report.summary.pageLoads.length > 1) {
      console.warn(
        `[perf-nav-walk] the webview re-based its clock ${report.summary.pageLoads.length - 1}x mid-walk; ` +
        `rows flagged firstOnPageLoad carry the app bootstrap: ${report.summary.firstOnPageLoad.join(', ')}`,
      );
    }
    console.log(`Report written: ${out}`);
    // A few stops may fail (e.g. a plugin disabled in starter tier),
    // but the suite passes overall as long as the report wrote successfully.
    expect(fs.existsSync(out)).toBe(true);
    // Sanity: at least L1 stops should have succeeded.
    const l1Failures = results.filter((r) => r.stop.group === 'L1' && r.status === 'failed');
    expect(l1Failures.length).toBe(0);
  });
});
