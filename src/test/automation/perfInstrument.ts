/**
 * Performance instrumentation for test runs.
 *
 * Loaded only when test automation is active (see App.tsx — gated on
 * import.meta.env.DEV || window.__PERSONAS_TEST_MODE__). Exposes
 * `window.__PERF__` so the test-automation HTTP bridge can reset counters,
 * take snapshots, and emit marks. Captures:
 *
 *   1. **IPC invocations** — count + total duration + per-command breakdown,
 *      by patching window.__TAURI_INTERNALS__.invoke at module load. This
 *      catches every Tauri command regardless of which import path the
 *      caller uses (@tauri-apps/api/core, plugin wrappers, etc).
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

/**
 * Patch Tauri's low-level IPC dispatcher to count + time every command.
 * The standard @tauri-apps/api/core::invoke ultimately calls
 * window.__TAURI_INTERNALS__.invoke, so patching that catches every call
 * site regardless of import path. Idempotent — returns true if patch
 * applied (or already present), false if the internals weren't available.
 */
function patchTauriInternals(): boolean {
  type InvokeFn = (cmd: string, args?: unknown, opts?: unknown) => unknown;
  type Internals = { invoke?: InvokeFn };
  const w = window as unknown as { __TAURI_INTERNALS__?: Internals };
  const internals = w.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== 'function') return false;

  const originalInvoke = internals.invoke;
  // Avoid double-patching across HMR / repeated module evaluation.
  if ((originalInvoke as { __perfPatched?: boolean }).__perfPatched) return true;

  const patched: InvokeFn = function (this: unknown, cmd, args, opts) {
    const cmdName = String(cmd ?? 'unknown');
    const start = performance.now();
    state.ipcCount += 1;
    let entry = state.ipcByCommand.get(cmdName);
    if (!entry) {
      entry = { count: 0, totalMs: 0 };
      state.ipcByCommand.set(cmdName, entry);
    }
    entry.count += 1;

    const recordDuration = () => {
      const dur = performance.now() - start;
      entry.totalMs += dur;
      state.ipcTotalMs += dur;
    };

    try {
      const result = originalInvoke.call(this, cmd, args, opts);
      if (result && typeof (result as { finally?: unknown }).finally === 'function') {
        return (result as Promise<unknown>).finally(recordDuration);
      }
      recordDuration();
      return result;
    } catch (err) {
      recordDuration();
      throw err;
    }
  };

  (patched as { __perfPatched?: boolean }).__perfPatched = true;
  internals.invoke = patched;
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
  };
}

function reset(): void {
  state = createInitialState();
}

function mark(label: string): void {
  state.marks.push({ label, tMs: performance.now() - state.resetAt });
}

// ── Initialise on load ────────────────────────────────────────────────────

const ipcPatched = patchTauriInternals();

// Expose on window so the Rust test-automation bridge can call into us
// via eval. The bridge.ts dispatcher also picks up these methods through
// the `[key: string]: unknown` index on TestBridge.
interface PerfApi {
  reset: () => void;
  snapshot: () => PerfSnapshot;
  mark: (label: string) => void;
  recordRender: typeof recordRender;
  ipcPatched: boolean;
}

const perfApi: PerfApi = {
  reset,
  snapshot,
  mark,
  recordRender,
  ipcPatched,
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
