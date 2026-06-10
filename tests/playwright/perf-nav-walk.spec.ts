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
 *   docs/harness/perf-runs/<ISO-timestamp>.json
 *
 * Extending: add entries to the STOPS array below. Each stop is a label +
 * an async function that drives the app into a state. The framework
 * handles reset / wait-idle / snapshot per stop.
 */

const BASE = `http://127.0.0.1:${process.env.COMPANION_TEST_PORT ?? 17320}`;

interface PerfSnapshot {
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

/** Wait until IPC count is stable for `stableMs`, or `maxMs` elapses. */
async function waitForIdle(stableMs = 600, maxMs = 8_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  let lastCount = -1;
  let lastChangeAt = Date.now();
  // Initial settle delay so the first navigate has a chance to kick off
  // its work before we start polling.
  await new Promise((r) => setTimeout(r, 100));
  while (Date.now() < deadline) {
    const snap = await snapshotPerf();
    if (snap.ipc.totalCount !== lastCount) {
      lastCount = snap.ipc.totalCount;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= stableMs) {
      return;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  // Time-bounded; if we didn't settle that's still a useful data point.
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
  { id: 'plugins/companion',      group: 'plugins', description: 'Companion plugin page',      setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'companion' }); } },
  { id: 'plugins/artist',         group: 'plugins', description: 'Artist plugin (default)',    setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'artist' }); } },
  { id: 'plugins/dev-tools',      group: 'plugins', description: 'Dev tools plugin',           setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'dev-tools' }); } },
  { id: 'plugins/obsidian-brain', group: 'plugins', description: 'Obsidian Brain plugin',      setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'obsidian-brain' }); } },
  { id: 'plugins/research-lab',   group: 'plugins', description: 'Research Lab plugin',        setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'research-lab' }); } },
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
  { id: 'twin/identity',  group: 'twin', description: 'Twin → Identity',  setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'identity' }); } },
  { id: 'twin/brain',     group: 'twin', description: 'Twin → Brain',     setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'brain' }); } },
  { id: 'twin/voice',     group: 'twin', description: 'Twin → Voice',     setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'voice' }); } },
  { id: 'twin/channels',  group: 'twin', description: 'Twin → Channels',  setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'channels' }); } },
  { id: 'twin/training',  group: 'twin', description: 'Twin → Training',  setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'twin' }); await bridgeExec('setTwinTab', { tab: 'training' }); } },

  // Artist sub-tabs (when artist plugin is active)
  { id: 'artist/blender',      group: 'artist', description: 'Artist → Blender',     setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'artist' }); await bridgeExec('setArtistTab', { tab: 'blender' }); } },
  { id: 'artist/gallery',      group: 'artist', description: 'Artist → Gallery',     setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'artist' }); await bridgeExec('setArtistTab', { tab: 'gallery' }); } },
  { id: 'artist/media-studio', group: 'artist', description: 'Artist → Media Studio', setup: async () => { await navigate('plugins'); await bridgeExec('setPluginTab', { tab: 'artist' }); await bridgeExec('setArtistTab', { tab: 'media-studio' }); } },

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

// ── Report writer ───────────────────────────────────────────────────────────

interface StopResult {
  stop: { id: string; group: string; description: string };
  perf: PerfSnapshot;
  setupError?: string;
}

interface RunReport {
  meta: {
    timestamp: string;
    bridgeUrl: string;
    stopCount: number;
    gitHead?: string;
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
    for (const stop of STOPS) {
      const stopResult: StopResult = {
        stop: { id: stop.id, group: stop.group, description: stop.description },
        perf: probe, // placeholder; replaced below
      };
      try {
        await resetPerf();
        await stop.setup();
        await waitForIdle();
        stopResult.perf = await snapshotPerf();
        console.log(
          `[${stop.id.padEnd(30)}] renders=${stopResult.perf.render.commitCount.toString().padStart(3)} ` +
          `ipc=${stopResult.perf.ipc.totalCount.toString().padStart(3)} ` +
          `actualMs=${stopResult.perf.render.totalActualDurationMs.toFixed(1).padStart(6)} ` +
          `dom=${stopResult.perf.dom.nodeCount.toString().padStart(5)}`,
        );
      } catch (err) {
        stopResult.setupError = err instanceof Error ? err.message : String(err);
        console.warn(`[${stop.id}] FAILED: ${stopResult.setupError}`);
      }
      results.push(stopResult);
    }

    const report: RunReport = {
      meta: {
        timestamp: new Date().toISOString(),
        bridgeUrl: BASE,
        stopCount: STOPS.length,
      },
      stops: results,
    };
    const out = writeReport(report);
    console.log(`\nReport written: ${out}`);
    // A few stops may fail (e.g. a plugin disabled in starter tier),
    // but the suite passes overall as long as the report wrote successfully.
    expect(fs.existsSync(out)).toBe(true);
    // Sanity: at least L1 stops should have succeeded.
    const l1Failures = results.filter((r) => r.stop.group === 'L1' && r.setupError);
    expect(l1Failures.length).toBe(0);
  });
});
