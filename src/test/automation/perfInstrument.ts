/**
 * Performance instrumentation for test runs.
 *
 * Loaded only when test automation is active (see App.tsx — gated on
 * import.meta.env.DEV || window.__PERSONAS_TEST_MODE__). Exposes
 * `window.__PERF__` so the test-automation HTTP bridge can reset counters,
 * take snapshots, and emit marks. Captures:
 *
 *   1. **IPC invocations** — count + total duration + per-command breakdown,
 *      by subscribing to `subscribeIpcMetrics` from @/lib/ipcMetrics. Every
 *      Personas invoke that goes through `tauriInvoke.ts` is recorded there
 *      automatically. (Tauri 2 makes window.__TAURI_INTERNALS__.invoke
 *      non-configurable, so monkey-patching at that layer fails — see commit
 *      history for the rejected attempt.) Calls that bypass tauriInvoke.ts
 *      and hit @tauri-apps/api/core::invoke directly are NOT counted; today
 *      that's a small minority and a known measurement gap.
 *
 *   2. **React render commits** — fed by a root `<Profiler>` in App.tsx
 *      via `recordRender()`. Tracks commit count plus actual + base
 *      durations summed across the measurement window.
 *
 *   3. **Marks** — user-defined `mark(label)` points so a test can annotate
 *      sub-phases ("after click", "after settle") inside one reset/snapshot
 *      window. Useful for slicing render cost between user-action and
 *      post-action settle.
 *
 *   4. **DOM node count** at snapshot time — a cheap proxy for tree
 *      complexity. Captured by document.querySelectorAll('*').length.
 *
 *   5. **Long tasks** — PerformanceObserver('longtask'). The single best proxy
 *      for user-visible jank: any main-thread block over 50ms is a frame the
 *      user did not get. Reported as count + total blocked ms + the longest
 *      one, because "many small stalls" and "one huge stall" are different
 *      failures and an average hides both.
 *
 *   6. **Frame timing** — a rAF sampler. Total frames, frames slower than 33ms
 *      (a missed 30fps beat) and 50ms, plus p95 frame time. Render *cost* and
 *      render *smoothness* are not the same measurement: React can report a
 *      cheap average commit while the compositor drops every third frame.
 *
 *   7. **Harness event arrivals** — a dedicated listener on the two synthetic
 *      load events. This exists so a run can compare what Rust EMITTED against
 *      what the webview RECEIVED; without it a saturated transport looks
 *      exactly like a fast renderer. It costs one counter increment per event,
 *      in test mode only.
 *
 * Additions 5-7 exist for the load-harness runs (scripts/perf/load-harness.mjs).
 * The idle-only metrics above answer "is this cheap when nothing is happening",
 * which is the question that does NOT decide a renderer.
 *
 * Zero overhead in production: this module is not imported in prod bundles,
 * and App.tsx's Profiler `onRender` callback is the cheapest path possible
 * (one object lookup) when __PERF__ is not present.
 */
import { listen } from '@tauri-apps/api/event';

import { silentCatch } from '@/lib/silentCatch';

import {
  subscribeIpcMetrics,
  getIpcRecords,
  getIpcTotalCount,
} from '@/lib/ipcMetrics';

interface PerCommandStats {
  count: number;
  totalMs: number;
}

interface PerfState {
  resetAt: number;
  marks: Array<{ label: string; tMs: number }>;
  ipcCount: number;
  ipcByCommand: Map<string, PerCommandStats>;
  ipcTotalMs: number;
  renderCommitCount: number;
  renderActualMs: number;
  renderBaseMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  /** Every frame delta since reset, in ms. Bounded — see MAX_FRAME_SAMPLES. */
  frameDeltas: number[];
  frameOverflow: number;
  eventsReceived: Map<string, number>;
}

export interface PerfSnapshot {
  resetAt: number;
  snapshotAt: number;
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
  dom: {
    nodeCount: number;
  };
  /** Main-thread blocks >50ms. The jank measurement. */
  longTasks: {
    count: number;
    totalMs: number;
    maxMs: number;
    /** Share of the window spent blocked. The number to watch on a ramp. */
    blockedPct: number;
  };
  /** Frame pacing. `null` when no frames were sampled (window too short). */
  frames: {
    count: number;
    /** Frames slower than a 30fps beat — a visible hitch. */
    over33ms: number;
    /** Frames slower than 50ms — a stall the user reads as a freeze. */
    over50ms: number;
    p95Ms: number;
    avgMs: number;
    /** True -> more frames occurred than were retained; p95 covers the first
     *  MAX_FRAME_SAMPLES only. */
    truncated: boolean;
  } | null;
  /** Synthetic-load events that actually reached the webview. Compare against
   *  the harness's `emittedOutput` / `emittedState` to detect a saturated
   *  transport, which otherwise reads as a fast renderer. */
  eventsReceived: Array<{ name: string; count: number }>;
  /** JS heap (Chromium `performance.memory`). Present in WebView2; `null` where
   *  the non-standard API is unavailable. Bytes. The honest "real memory" read
   *  for prod-build perf measurement (dev heap is inflated by Vite/HMR). */
  memory: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } | null;
  diagnostics?: {
    ipcSubscribed: boolean;
    /** False -> this engine has no `longtask` entry type and the jank numbers
     *  above are all zero for that reason, not because nothing blocked. */
    longTasksSupported: boolean;
    /** False -> the rAF sampler never attached; `frames` is null for that
     *  reason rather than because the window was too short. */
    framesSampled: boolean;
    /** False -> `eventsReceived` is empty because nothing is counting, not
     *  because nothing arrived. Without this the emitted-vs-received check
     *  reports a saturated transport that is actually fine. */
    eventCountersAttached: boolean;
  };
}

function createInitialState(): PerfState {
  return {
    resetAt: performance.now(),
    marks: [],
    ipcCount: 0,
    ipcByCommand: new Map(),
    ipcTotalMs: 0,
    renderCommitCount: 0,
    renderActualMs: 0,
    renderBaseMs: 0,
    longTaskCount: 0,
    longTaskTotalMs: 0,
    longTaskMaxMs: 0,
    frameDeltas: [],
    frameOverflow: 0,
    eventsReceived: new Map(),
  };
}

/**
 * Cap on retained frame samples. At 60fps a 60-second step is 3,600 samples;
 * the cap is generous enough for a long hold and bounded so a forgotten reset
 * cannot grow an array until the measurement itself is the thing allocating.
 * Overflow is COUNTED, not silently dropped — a step that overflowed reports a
 * p95 over its first N frames and says so.
 */
const MAX_FRAME_SAMPLES = 20_000;

let state: PerfState = createInitialState();
// Baseline of getIpcTotalCount() at the last reset. Used to compute how
// many new records have arrived since reset by comparing with the current
// count, then taking the last N records from the ring buffer.
let ipcBaselineTotal = 0;

function ingestNewIpcRecords(): void {
  const currTotal = getIpcTotalCount();
  const newSince = currTotal - ipcBaselineTotal;
  if (newSince <= 0) return;
  const allRecords = getIpcRecords();
  // Ring buffer holds at most RING_SIZE entries; if too many calls have
  // landed since reset, oldest are dropped. We take the most recent
  // min(newSince, allRecords.length) entries to stay correct.
  const take = Math.min(newSince, allRecords.length);
  const slice = allRecords.slice(-take);
  for (const r of slice) {
    state.ipcCount += 1;
    let e = state.ipcByCommand.get(r.command);
    if (!e) {
      e = { count: 0, totalMs: 0 };
      state.ipcByCommand.set(r.command, e);
    }
    e.count += 1;
    e.totalMs += r.durationMs;
    state.ipcTotalMs += r.durationMs;
  }
  ipcBaselineTotal = currTotal;
}

/**
 * Subscribe to @/lib/ipcMetrics so every Tauri command recorded by
 * tauriInvoke.ts (the app-wide IPC wrapper) feeds into our state.
 * Idempotent across HMR — the listener is added once per module evaluation;
 * we keep a single unsubscriber on the module object so re-evals replace it
 * cleanly. Returns true if the subscription was attached.
 */
let unsubscribeIpc: (() => void) | null = null;
function attachIpcSubscription(): boolean {
  if (typeof subscribeIpcMetrics !== 'function') return false;
  if (unsubscribeIpc) {
    unsubscribeIpc();
    unsubscribeIpc = null;
  }
  ipcBaselineTotal = getIpcTotalCount();
  unsubscribeIpc = subscribeIpcMetrics(ingestNewIpcRecords);
  return true;
}

/**
 * Called by the root `<Profiler>` in App.tsx on every commit. Sums the
 * actualDuration (commit time, including children) and baseDuration
 * (estimate of unmemoized cost) across the measurement window. Phase is
 * ignored here — we want the wall-clock cost regardless of mount vs.
 * update — but is preserved in the signature for future per-phase
 * breakdowns.
 */
export function recordRender(
  _id: string,
  _phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  baseDuration: number,
): void {
  state.renderCommitCount += 1;
  state.renderActualMs += actualDuration;
  state.renderBaseMs += baseDuration;
}

function snapshot(): PerfSnapshot {
  // Drain any IPC records that arrived since the last subscriber notification
  // but haven't been ingested yet (the listener fires per-record, but we may
  // be called between adds — re-pull to be sure).
  ingestNewIpcRecords();
  const now = performance.now();
  const byCommand = Array.from(state.ipcByCommand.entries())
    .map(([command, e]) => ({
      command,
      count: e.count,
      totalMs: Math.round(e.totalMs * 100) / 100,
      avgMs: e.count > 0 ? Math.round((e.totalMs / e.count) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    resetAt: state.resetAt,
    snapshotAt: now,
    durationMs: Math.round((now - state.resetAt) * 100) / 100,
    marks: state.marks.map((m) => ({ ...m, tMs: Math.round(m.tMs * 100) / 100 })),
    ipc: {
      totalCount: state.ipcCount,
      totalDurationMs: Math.round(state.ipcTotalMs * 100) / 100,
      byCommand,
    },
    render: {
      commitCount: state.renderCommitCount,
      totalActualDurationMs: Math.round(state.renderActualMs * 100) / 100,
      totalBaseDurationMs: Math.round(state.renderBaseMs * 100) / 100,
      avgActualMs:
        state.renderCommitCount > 0
          ? Math.round((state.renderActualMs / state.renderCommitCount) * 100) / 100
          : 0,
    },
    dom: {
      nodeCount: document.querySelectorAll('*').length,
    },
    longTasks: {
      count: state.longTaskCount,
      totalMs: Math.round(state.longTaskTotalMs * 100) / 100,
      maxMs: Math.round(state.longTaskMaxMs * 100) / 100,
      blockedPct:
        now > state.resetAt
          ? Math.round((state.longTaskTotalMs / (now - state.resetAt)) * 10000) / 100
          : 0,
    },
    frames: summariseFrames(),
    eventsReceived: Array.from(state.eventsReceived.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    memory: readJsHeap(),
    diagnostics: {
      ipcSubscribed: unsubscribeIpc !== null,
      longTasksSupported,
      framesSampled,
      eventCountersAttached,
    },
  };
}

/**
 * p95 over the retained frame deltas.
 *
 * Sorted copy rather than a streaming estimator: a step holds a few thousand
 * samples at most, the sort happens once per snapshot (not per frame), and an
 * exact percentile is worth more than a cheap approximation when the whole
 * point of the number is to catch the tail.
 */
function summariseFrames(): PerfSnapshot['frames'] {
  const d = state.frameDeltas;
  if (d.length === 0) return null;
  const sorted = [...d].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  let sum = 0;
  let over33 = 0;
  let over50 = 0;
  for (const v of d) {
    sum += v;
    if (v > 33) over33 += 1;
    if (v > 50) over50 += 1;
  }
  return {
    count: d.length + state.frameOverflow,
    over33ms: over33,
    over50ms: over50,
    p95Ms: Math.round(p95 * 100) / 100,
    avgMs: Math.round((sum / d.length) * 100) / 100,
    truncated: state.frameOverflow > 0,
  };
}

/**
 * Long-task observer. Registered once for the life of the module; entries land
 * in whatever measurement window is open, and `reset()` zeroes the counters
 * rather than tearing the observer down — re-registering per window would miss
 * tasks that straddle a step boundary, which are exactly the interesting ones.
 */
function attachLongTaskObserver(): boolean {
  if (typeof PerformanceObserver === 'undefined') return false;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTaskCount += 1;
        state.longTaskTotalMs += entry.duration;
        if (entry.duration > state.longTaskMaxMs) state.longTaskMaxMs = entry.duration;
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
    return true;
  } catch {
    // Not supported in this engine — `frames` still gives a smoothness read.
    return false;
  }
}

/**
 * Frame sampler. One rAF chained forever: two subtractions and a push per
 * frame, which is the cheapest honest way to see what the compositor actually
 * delivered. Test-mode only, so production pays nothing.
 */
function attachFrameSampler(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  let last = performance.now();
  const step = (t: number) => {
    const dt = t - last;
    last = t;
    // Skip any absurd delta (window hidden, debugger paused) — those measure
    // the environment, not the app.
    if (dt > 0 && dt < 2000) {
      if (state.frameDeltas.length < MAX_FRAME_SAMPLES) state.frameDeltas.push(dt);
      else state.frameOverflow += 1;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Count arrivals of the synthetic-load events.
 *
 * Deliberately its own listener rather than a hook inside the app's handlers:
 * it must keep counting even if a store subscription is torn down, unmounted or
 * throws, because "the UI stopped consuming" is one of the outcomes a stress
 * run needs to be able to see.
 */
function attachEventCounters(): void {
  const count = (name: string) => {
    void listen(name, () => {
      state.eventsReceived.set(name, (state.eventsReceived.get(name) ?? 0) + 1);
      // A counter that could not register is a missing metric, never a reason
      // to take anything else down with it — but it IS a swallowed error, so it
      // goes through the sanctioned helper rather than an inline handler that
      // skips the Sentry breadcrumb.
    }).catch(silentCatch('perf:event-counter'));
  };
  count('fleet-session-output');
  count('fleet-session-state');
}

/** Read Chromium's non-standard `performance.memory` if present (WebView2 has
 *  it). Returns null elsewhere so callers can degrade gracefully. */
function readJsHeap(): PerfSnapshot['memory'] {
  const mem = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  if (!mem) return null;
  return {
    usedJSHeapSize: mem.usedJSHeapSize,
    totalJSHeapSize: mem.totalJSHeapSize,
    jsHeapSizeLimit: mem.jsHeapSizeLimit,
  };
}

function reset(): void {
  state = createInitialState();
  ipcBaselineTotal = getIpcTotalCount();
}

function mark(label: string): void {
  state.marks.push({ label, tMs: performance.now() - state.resetAt });
}

// ── Initialise on load ────────────────────────────────────────────────────

// THESE RUN AT MODULE SCOPE, SO EACH IS ISOLATED.
//
// This module's real job is to install `window.__PERF__` and hang the `perf*`
// methods on the already-loaded `window.__TEST__` bridge. Everything below is a
// metric COLLECTOR, and a collector that throws while this module evaluates
// takes the perf surface down with it — `/perf/*` then returns empty while the
// app looks perfectly healthy on screen, which is the worst shape a measurement
// bug can have. No collector is allowed to be load-bearing: each failure is
// recorded in `diagnostics` instead of thrown, and a missing metric degrades
// that metric alone.
function attempt(what: string, fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    // test-mode only, and a silently absent metric is worse than a console
    // line nobody reads.
    console.warn(`[perf] collector "${what}" did not attach; its metrics read zero`);
    return false;
  }
}

const ipcSubscribed = attempt('ipc', attachIpcSubscription);
const longTasksSupported = attempt('longtask', attachLongTaskObserver);
const framesSampled = attempt('frames', () => {
  attachFrameSampler();
  return true;
});
const eventCountersAttached = attempt('events', () => {
  attachEventCounters();
  return true;
});

// Expose on window so the Rust test-automation bridge can call into us
// via eval. The bridge.ts dispatcher also picks up these methods through
// the `[key: string]: unknown` index on TestBridge.
interface PerfApi {
  reset: () => void;
  snapshot: () => PerfSnapshot;
  mark: (label: string) => void;
  recordRender: typeof recordRender;
  ipcSubscribed: boolean;
}

const perfApi: PerfApi = {
  reset,
  snapshot,
  mark,
  recordRender,
  ipcSubscribed,
};

(window as unknown as { __PERF__: PerfApi }).__PERF__ = perfApi;

// Also register methods on window.__TEST__ so the existing bridge dispatcher
// (`__exec__(id, method, params)`) can reach them without any new wiring.
// The test-automation HTTP server's /perf/* endpoints add the URL surface,
// but they dispatch through the same `eval_bridge_method` plumbing.
type TestBridge = Record<string, unknown> | undefined;
const testBridge = (window as unknown as { __TEST__?: TestBridge }).__TEST__;
if (testBridge) {
  testBridge.perfReset = () => {
    reset();
    return { success: true };
  };
  testBridge.perfSnapshot = () => snapshot();
  testBridge.perfMark = (label: string) => {
    mark(label);
    return { success: true, label };
  };
}
