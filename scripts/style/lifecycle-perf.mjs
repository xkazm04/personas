#!/usr/bin/env node
// Lifecycle performance probe (Lifecycle excellence wave 10): the page's cost
// on the synthetic tape, measured in a real Chromium through the page harness.
//
// The harness module `plugins/lifecycle/perf` (lifecycleSurfaces.tsx) mounts
// the integrated LifecyclePage under one React <Profiler> that appends every
// commit to `window.__LC_PROFILE__`, and puts the live store on
// `window.__LC_LIVE__`. A PerformanceObserver collects long tasks (> 50 ms).
// For each run, in one page:
//
//   cold     first mount to Layer 1 on screen (the ghost, the snapshot, the rail)
//   revision a `lifecycleRevision` bump whose refetch returns the SAME data
//            (what every backend event does): commits and their cost
//   travel   picking a past Measure on the history, then back to now
//   open     pressing Gate's key to its command rows on screen (chunk + detail;
//            the chunks are warm after the idle prefetch, as in the app)
//   back     Esc from the step screen to the rail
//
// Each scenario reports wall time (performance.now around the action, until its
// result is in the DOM), React commits (count, summed and max actualDuration)
// and long tasks (count, max). Medians over --runs.
//
// Two builds: the default runs React's DEV build under the Vite dev server
// (durations are an upper bound); `--prod` first builds the harness for
// production with React's PROFILING build (react-dom/profiling, so the
// Profiler still reports) into tmp/lifecycle-perf-dist and serves that - the
// numbers a user's machine sees, give or take the profiling overhead.
//
// Usage: node scripts/style/lifecycle-perf.mjs [--prod] [--runs 5] [--port 4392] [--size 1920x1080] [--out <file.json>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS, launchHarnessBrowser, startHarnessServer } from './page-harness/harnessRun.mjs';
import { buildSyntheticTape } from './page-harness/synthetic-tapes.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = 'plugins/lifecycle/perf';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const RUNS = Number(arg('runs', 5));
const PORT = Number(arg('port', 4392));
const [W, H] = String(arg('size', '1920x1080')).split('x').map(Number);
const OUT = arg('out', null);
const PROD = process.argv.includes('--prod');

/** Run `act` in the page and wait (rAF-polled) until `selector` is present (or absent with `gone`). */
async function timed(page, act, selector, { gone = false, settle = 600 } = {}) {
  const mark = await page.evaluate(() => ({ commits: window.__LC_PROFILE__?.length ?? 0, lt: window.__LT.length }));
  const wall = await page.evaluate(async ({ act, selector, gone }) => {
    const t0 = performance.now();
    // eslint-disable-next-line no-new-func
    new Function(act)();
    const done = () => (gone ? !document.querySelector(selector) : !!document.querySelector(selector));
    await new Promise((res) => { const tick = () => (done() ? res() : requestAnimationFrame(tick)); tick(); });
    // Two frames more, so the commit that drew it has painted.
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return performance.now() - t0;
  }, { act, selector, gone });
  await page.waitForTimeout(settle);
  return page.evaluate(({ mark, wall }) => {
    const commits = (window.__LC_PROFILE__ ?? []).slice(mark.commits);
    const lt = window.__LT.slice(mark.lt);
    const page = commits.filter((c) => c.id === 'lifecycle');
    // Nested profilers (added while investigating) are reported by id, never summed into the page.
    const byId = {};
    for (const c of commits) if (c.id !== 'lifecycle') byId[c.id] = (byId[c.id] ?? 0) + c.actual;
    return {
      wallMs: wall,
      commits: page.length,
      renderMs: page.reduce((n, c) => n + c.actual, 0),
      maxCommitMs: page.reduce((n, c) => Math.max(n, c.actual), 0),
      longTasks: lt.length,
      maxLongTaskMs: lt.reduce((n, t) => Math.max(n, t.dur), 0),
      ...(Object.keys(byId).length ? { byId } : {}),
    };
  }, { mark, wall });
}

async function oneRun(browser, url, tape) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  // No fixed clock: Playwright's fixed time stalls framer-motion's exit animations at random, which
  // read as seconds of wall time that no user sees (relative times on the page read off by days; no matter).
  await page.addInitScript((t) => {
    window.__PAGE_HARNESS_TAPE__ = t;
    window.__LT = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__LT.push({ start: e.startTime, dur: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  }, tape);
  await page.goto(`${url}${HARNESS}?module=${encodeURIComponent(MODULE)}&theme=dark-midnight`, { waitUntil: 'commit' });
  await page.waitForSelector('[data-testid="lc1-layer1"]', { timeout: 180_000 });
  await page.waitForTimeout(400);
  const cold = await page.evaluate(() => {
    const commits = (window.__LC_PROFILE__ ?? []).filter((c) => c.id === 'lifecycle');
    const mountAt = commits[0]?.start ?? 0;
    const lt = window.__LT.filter((t) => t.start >= mountAt);
    return {
      wallMs: (commits[commits.length - 1]?.commit ?? 0) - mountAt,
      commits: commits.length,
      renderMs: commits.reduce((n, c) => n + c.actual, 0),
      maxCommitMs: commits.reduce((n, c) => Math.max(n, c.actual), 0),
      longTasks: lt.length,
      maxLongTaskMs: lt.reduce((n, t) => Math.max(n, t.dur), 0),
    };
  });
  // Let the history read and the idle chunk prefetch finish, as a reader would.
  await page.waitForTimeout(2500);
  const revision = await timed(page, 'window.__LC_LIVE__.getState().markLifecycleChanged()', '[data-testid="lc1-layer1"]', { settle: 1200 });
  const cols = await page.locator('[data-testid^="lc-history-col-"]').count();
  const travel = await timed(page, `document.querySelector('[data-testid="lc-history-col-${Math.max(0, cols - 3)}"]').click()`, '[data-testid="lc-travel-lead"]');
  const travelBack = await timed(page, `document.querySelector('[data-testid="lc-travel-back"]').click()`, '[data-testid="lc-travel-lead"]', { gone: true });
  const open = await timed(page, `document.querySelector('[data-testid="lc-node-gate"]').click()`, '[data-testid^="lc2-cmd-"]', { settle: 1000 });
  const back = await timed(page, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, '[data-testid="lc-journey-track"]', { settle: 800 });
  await context.close();
  return { cold, revision, travel, travelBack, open, back };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function main() {
  const tape = buildSyntheticTape(MODULE, REPO);
  const browser = await launchHarnessBrowser();
  const { server, url } = await startHarnessServer({ port: PORT, prod: PROD, dist: join(REPO, 'tmp', 'lifecycle-perf-dist') });
  const runs = [];
  try {
    // One discarded warm-up: the first page pays Vite's transforms, which are not the page's cost.
    await oneRun(browser, url, tape);
    for (let i = 0; i < RUNS; i++) runs.push(await oneRun(browser, url, tape));
  } finally {
    await browser.close();
    await server.close();
  }
  const summary = {};
  for (const scenario of Object.keys(runs[0])) {
    summary[scenario] = {};
    for (const metric of Object.keys(runs[0][scenario])) {
      if (metric === 'byId') continue;
      summary[scenario][metric] = Number(median(runs.map((r) => r[scenario][metric])).toFixed(1));
    }
  }
  const report = { module: MODULE, size: `${W}x${H}`, runs: RUNS, reactBuild: PROD ? 'production + react-dom/profiling (vite build, preview)' : 'development (Vite dev server)', createdAt: new Date().toISOString(), median: summary, all: runs };
  console.table(summary);
  const ids = runs[0] && Object.entries(runs[runs.length - 1]).filter(([, v]) => v.byId);
  for (const [scenario, v] of ids) console.log(scenario, JSON.stringify(Object.fromEntries(Object.entries(v.byId).map(([k, n]) => [k, Number(n.toFixed(1))]))));
  if (OUT) {
    mkdirSync(dirname(resolve(OUT)), { recursive: true });
    writeFileSync(resolve(OUT), JSON.stringify(report, null, 2));
    console.log(`report: ${resolve(OUT)}`);
  }
}

main().catch((err) => { console.error(err?.stack ?? String(err)); process.exitCode = 1; });
