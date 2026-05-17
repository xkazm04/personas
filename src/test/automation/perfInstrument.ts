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
 * Zero overhead in production: this module is not imported in prod bundles,
 * and App.tsx's Profiler `onRender` callback is the cheapest path possible
 * (one object lookup) when __PERF__ is not present.
 */
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
  diagnostics?: {
    ipcSubscribed: boolean;
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
  };
}

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
    diagnostics: {
      ipcSubscribed: unsubscribeIpc !== null,
    },
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

const ipcSubscribed = attachIpcSubscription();

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
