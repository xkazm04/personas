#!/usr/bin/env node
/**
 * Cold-load probe: how every navigable surface of the RUNNING app paints on a
 * visit, measured inside the webview through the test-automation server
 * (src-tauri/src/test_automation.rs, port 17320 by default).
 *
 * Per surface (sections from src/lib/navigation/registry.ts, tabs from
 * src/lib/analytics/navCatalog.ts - derived, never hand-listed; see
 * lib/cold-load-core.mjs), parked on another section first:
 *   chromeMs        first NEW visible heading / tab strip in #main-content
 *   contentMs       first frame with >= 40 visible chars (or a >= 48 px figure)
 *                   outside chrome, ghosts and aria-hidden
 *   blankFrames     frames after the old page left with no content and no ghost;
 *                   `blankMsBeyondGrace` is blank time past the 150 ms window the
 *                   delay-hidden ghosts (RouteChunkSkeleton) are allowed, counted
 *                   from the first blank frame
 *   cls             PerformanceObserver('layout-shift') sum over the load window
 *   scriptRequests  module/script/style requests the visit triggered (0 = the
 *                   chunk was already loaded or prefetched: a WARM module)
 *   ipcCount        IPC calls during the window; ipcSequentialDepth = longest
 *                   chain of calls each starting after the previous finished
 *                   (upper bound on the fetch waterfall), up to first content
 *   warm.contentMs  the same surface again after parking (module + data cache)
 *
 * The instrument is injected with /eval and read back with /bridge-exec (see
 * lib/cold-load-page.mjs for why that needs no bridge.ts change).
 *
 * Usage:
 *   node scripts/perf/cold-load-probe.mjs --dry                 # list derived surfaces, no app
 *   node scripts/perf/cold-load-probe.mjs                       # measure all, write out/
 *   node scripts/perf/cold-load-probe.mjs --only overview,teams/goals   # id prefixes
 *   node scripts/perf/cold-load-probe.mjs --render <run.json>   # re-render the scorecard
 *   options: --port N  --max-ms 8000  --settle-ms 600  --gap-ms 500  --no-warm  --out <dir>
 *
 * It navigates the app (and restores the starting section and tabs at the
 * end); it never reloads the webview, so "cold" means first visit in this page
 * load with whatever the shell already prefetched - `scriptRequests` says which.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNavRegistry,
  parseNavCatalog,
  deriveSurfaces,
  sequentialDepth,
  finalizeRun,
  renderScorecard,
  rankRows,
  PROPOSED_BAR,
} from './lib/cold-load-core.mjs';
import { installColdProbe } from './lib/cold-load-page.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const a = { port: 17320, maxMs: 8000, settleMs: 600, gapMs: 500, parkMs: 700, warm: true, dry: false, only: null, out: path.join(__dirname, 'out'), render: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--port') a.port = Number(v());
    else if (k === '--max-ms') a.maxMs = Number(v());
    else if (k === '--settle-ms') a.settleMs = Number(v());
    else if (k === '--gap-ms') a.gapMs = Number(v());
    else if (k === '--park-ms') a.parkMs = Number(v());
    else if (k === '--no-warm') a.warm = false;
    else if (k === '--dry') a.dry = true;
    else if (k === '--only') a.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '--render') a.render = path.resolve(v());
    else if (k === '--help' || k === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

export function loadSurfaces(repo = REPO) {
  const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
  const sections = parseNavRegistry(read('src/lib/navigation/registry.ts'));
  const dims = parseNavCatalog(read('src/lib/analytics/navCatalog.ts'), read('src/features/companions/types.ts'));
  return deriveSurfaces(sections, dims);
}

function parkFor(section) {
  return section === 'settings' ? 'home' : 'settings';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.render) {
    const run = JSON.parse(fs.readFileSync(args.render, 'utf8'));
    process.stdout.write(renderScorecard(finalizeRun(run)));
    return;
  }
  const { surfaces: all, unreachedDimensions } = loadSurfaces();
  const surfaces = args.only ? all.filter((s) => args.only.some((p) => s.id === p || s.id.startsWith(p + '/'))) : all;
  if (args.dry) {
    for (const s of surfaces) console.log(`${s.id}${s.needsPersona ? '  (selects first persona)' : ''}${s.gates.devOnly ? '  [dev-only]' : ''}${s.gates.minTier ? `  [tier ${s.gates.minTier}]` : ''}`);
    console.log(`\n${surfaces.length} surfaces${unreachedDimensions.length ? `; dimensions without a reach rule: ${unreachedDimensions.join(', ')}` : ''}`);
    return;
  }

  const base = `http://127.0.0.1:${args.port}`;
  const call = async (method, route, body, timeoutMs = 30_000) => {
    const res = await fetch(base + route, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${route} -> HTTP ${res.status} ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return text; }
  };
  const bridge = async (method, params = {}, timeoutSecs = 60) => {
    const r = await call('POST', '/bridge-exec', { method, params, timeout_secs: timeoutSecs }, (timeoutSecs + 15) * 1000);
    if (r && typeof r === 'object' && r.error) throw new Error(`${method}: ${r.error}`);
    return r;
  };

  const health = await call('GET', '/health').catch((e) => { throw new Error(`app not reachable on ${base}: ${e.message}`); });
  console.log(`[cold-load] app: ${JSON.stringify(health)}`);

  // Install, and prove it landed: /eval is fire-and-forget and has been seen
  // to drop scripts, so a version call through the bridge is the receipt.
  const js = `(${installColdProbe.toString()})();`;
  let version = null;
  for (let attempt = 1; attempt <= 3 && !version; attempt++) {
    await call('POST', '/eval', { js });
    await new Promise((r) => setTimeout(r, 300 * attempt));
    try { version = await bridge('coldProbeVersion', {}, 20); } catch (e) { console.log(`[cold-load] install attempt ${attempt}: ${e.message}`); }
  }
  if (!version?.success) throw new Error('could not install the in-page instrument (coldProbeVersion never answered)');
  console.log(`[cold-load] instrument: ${JSON.stringify(version)}`);

  const startedAt = new Date().toISOString();
  const caveats = [
    'Measured on a DEV build (Vite dev server, React development mode): absolute ms overstate a production build; the ranking and the blank/CLS/waterfall SHAPE transfer. Re-run against `tauri:dev:test` built with `--release`-like settings before treating a ms number as a regression.',
    '"Cold" = first visit in this page load. The probe never reloads the shared webview, and the shell idle-prefetches section chunks (navPrefetch.ts), so `scripts = 0` marks a module that was already warm; its chrome/content timings then measure render + data, not chunk fetch.',
    'Chrome and content are DOM heuristics (first new h1/h2/tablist/content-header; >= 40 visible chars or a >= 48 px figure outside chrome, ghosts and aria-hidden). A surface with no heading reports chrome n/a, which never fails the bar on its own.',
    'IPC depth is an UPPER bound on the fetch waterfall: two unrelated calls that ran back to back also chain. The bar uses the depth EXCLUDING commands already seen while parked (pollers, the park page); `ipcSequentialDepthRaw` keeps everything. A surface that genuinely re-fetches a command the park page also used is undercounted. Run-level pollers (commands already firing while parked before >= 25% of surfaces, listed in `ipcPollers`) are excluded from every chain. Calls that bypass invokeWithTimeout (raw invoke) are invisible to ipcMetrics.',
  ];
  if (!version.ipcMetrics) caveats.push(`IPC waterfall depth UNMEASURABLE in this build: the ipcMetrics module could not be imported by path (${version.ipcMetricsError ?? 'not a dev build'}); IPC counts come from window.__PERF__ when present.`);

  const captured = await bridge('coldProbeCapture', {}, 15);
  const rows = [];
  try {
    for (const [i, s] of surfaces.entries()) {
      const spec = {
        section: s.section,
        sets: s.sets,
        needsPersona: s.needsPersona,
        park: parkFor(s.section),
        parkMs: args.parkMs,
        maxMs: args.maxMs,
        settleMs: args.settleMs,
        graceMs: PROPOSED_BAR.graceMs,
        frameTolMs: PROPOSED_BAR.frameTolMs,
        skipWarm: !args.warm,
      };
      const budgetMs = 2 * (args.maxMs + args.parkMs + 1000) + 5000;
      let res;
      try {
        res = await bridge('coldProbeMeasure', { spec, timeoutMs: budgetMs }, Math.ceil(budgetMs / 1000) + 10);
      } catch (e) {
        res = { cold: { ok: false, error: e.message }, warm: null };
      }
      const row = { id: s.id, section: s.section, sets: s.sets, gates: s.gates, cold: res.cold, warm: res.warm };
      for (const phase of [row.cold, row.warm]) {
        if (!phase?.ok) continue;
        if (Array.isArray(phase.ipcCalls)) {
          const raw = sequentialDepth(phase.ipcCalls);
          phase.ipcSequentialDepthRaw = raw.depth;
          phase.ipcChainRaw = raw.chain;
          const bg = new Set(phase.ipcBackground ?? []);
          const own = sequentialDepth(phase.ipcCalls.filter((x) => !bg.has(x.command)));
          phase.ipcSequentialDepth = own.depth;
          phase.ipcChain = own.chain;
        } else {
          phase.ipcSequentialDepth = null;
        }
      }
      rows.push(row);
      const c = row.cold;
      console.log(`[cold-load] ${String(i + 1).padStart(3)}/${surfaces.length} ${s.id.padEnd(40)} ${c?.ok ? `chrome=${fmt(c.chromeMs)} content=${fmt(c.contentMs)} blank=${fmt(c.blankMsBeyondGrace)} cls=${c.cls} scripts=${c.scriptRequests} ipc=${c.ipcCount}/${c.ipcSequentialDepth} warm=${fmt(row.warm?.contentMs)}` : `SKIP ${c?.reason ?? c?.error}`}`);
      await new Promise((r) => setTimeout(r, args.gapMs));
    }
  } finally {
    await bridge('coldProbeRestore', { snapshot: captured.snapshot }, 15).catch((e) => console.log(`[cold-load] restore failed: ${e.message}`));
  }

  const run = {
    tool: 'scripts/perf/cold-load-probe.mjs',
    version: version.version,
    startedAt,
    finishedAt: new Date().toISOString(),
    port: args.port,
    buildMode: version.ipcMetrics ? 'dev build' : 'non-dev build',
    options: { maxMs: args.maxMs, settleMs: args.settleMs, parkMs: args.parkMs, gapMs: args.gapMs, warm: args.warm, only: args.only },
    bar: PROPOSED_BAR,
    unreachedDimensions,
    caveats,
    rows,
  };
  finalizeRun(run);
  fs.mkdirSync(args.out, { recursive: true });
  const day = startedAt.slice(0, 10);
  const jsonPath = path.join(args.out, `cold-load-${day}.json`);
  const mdPath = path.join(args.out, `cold-load-${day}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2) + '\n');
  fs.writeFileSync(mdPath, renderScorecard(run));
  const ranked = rankRows(rows).filter((r) => r.cold?.ok);
  console.log(`[cold-load] wrote ${path.relative(REPO, jsonPath)} and ${path.relative(REPO, mdPath)}; ${ranked.filter((r) => r.verdict.fails.length).length}/${ranked.length} measured surfaces fail the proposed bar`);
}

function fmt(v) {
  return v == null ? 'n/a' : Math.round(v);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[cold-load] ${e.stack || e.message}`);
    process.exit(1);
  });
}
