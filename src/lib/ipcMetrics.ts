// -- IPC Call Duration Ring Buffer -------------------------------------
// Pure frontend instrumentation -- records timing for every Tauri IPC call.

const RING_SIZE = 500;

export interface IpcCallRecord {
  command: string;
  durationMs: number;
  ok: boolean;
  timestamp: number;
  /**
   * True when the failure was an actual IPC timeout (InvokeTimeoutError), set by
   * the invoke wrapper. Timeout metrics key on THIS, not a duration threshold —
   * a duration heuristic missed short-timeout commands and miscounted slow
   * successes as timeouts.
   */
  timedOut?: boolean;
}

export interface IpcCommandStats {
  command: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  timeoutCount: number;
  errorCount: number;
  timeoutRate: number;
  errorRate: number;
}

// Ring buffer -- overwrites oldest entries when full
const ring: IpcCallRecord[] = [];
let writeIndex = 0;
let totalRecords = 0;
// Cumulative counters for LIFETIME rates. The ring only holds the last
// RING_SIZE calls, so deriving a global timeout/error rate from it is wrong once
// more than RING_SIZE calls have happened (the rate then reflects only the
// recent window while totalCalls is lifetime). These never-evicted counters keep
// the global rates accurate over the whole session.
let totalTimeouts = 0;
let totalErrors = 0;

export function recordIpcCall(record: IpcCallRecord): void {
  if (ring.length < RING_SIZE) {
    ring.push(record);
  } else {
    ring[writeIndex] = record;
  }
  writeIndex = (writeIndex + 1) % RING_SIZE;
  totalRecords++;
  if (!record.ok) totalErrors++;
  if (record.timedOut) totalTimeouts++;
  // Notify subscribers
  for (const fn of listeners) fn();
}

export function getIpcRecords(): IpcCallRecord[] {
  // Return in chronological order
  if (ring.length < RING_SIZE) return ring.slice();
  return [...ring.slice(writeIndex), ...ring.slice(0, writeIndex)];
}

export function getIpcTotalCount(): number {
  return totalRecords;
}

// -- Percentile Computation ------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// -- Per-Command Stats -----------------------------------------------

export function computeCommandStats(): IpcCommandStats[] {
  const records = getIpcRecords();
  const byCmd = new Map<string, IpcCallRecord[]>();

  for (const r of records) {
    const arr = byCmd.get(r.command);
    if (arr) arr.push(r);
    else byCmd.set(r.command, [r]);
  }

  const stats: IpcCommandStats[] = [];
  for (const [command, calls] of byCmd) {
    const durations = calls.map(c => c.durationMs).sort((a, b) => a - b);
    const timeoutCount = calls.filter(c => !c.ok && c.timedOut === true).length;
    const errorCount = calls.filter(c => !c.ok).length;

    stats.push({
      command,
      count: calls.length,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      timeoutCount,
      errorCount,
      timeoutRate: calls.length > 0 ? timeoutCount / calls.length : 0,
      errorRate: calls.length > 0 ? errorCount / calls.length : 0,
    });
  }

  // Sort by p95 descending (slowest commands first)
  stats.sort((a, b) => b.p95 - a.p95);
  return stats;
}

// -- Slowest Recent Calls --------------------------------------------

export function getSlowestCalls(n: number): IpcCallRecord[] {
  return getIpcRecords()
    .slice()
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, n);
}

// -- Global Summary --------------------------------------------------

export interface IpcGlobalSummary {
  totalCalls: number;
  avgDurationMs: number;
  p50: number;
  p95: number;
  p99: number;
  timeoutRate: number;
  errorRate: number;
}

export function getGlobalSummary(): IpcGlobalSummary {
  const records = getIpcRecords();
  if (records.length === 0) {
    return { totalCalls: 0, avgDurationMs: 0, p50: 0, p95: 0, p99: 0, timeoutRate: 0, errorRate: 0 };
  }
  const durations = records.map(r => r.durationMs).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    totalCalls: totalRecords,
    avgDurationMs: sum / durations.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    // Lifetime rates from cumulative counters — consistent with totalCalls and
    // accurate past RING_SIZE calls (percentiles stay windowed by necessity:
    // they need the retained duration samples). Guard the divide for safety.
    timeoutRate: totalRecords > 0 ? totalTimeouts / totalRecords : 0,
    errorRate: totalRecords > 0 ? totalErrors / totalRecords : 0,
  };
}

// -- Subscription for React ------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeIpcMetrics(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
