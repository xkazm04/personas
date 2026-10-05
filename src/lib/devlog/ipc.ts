// ---------------------------------------------------------------------------
// IPC producers, fed by the settle path of `invokeWithTimeout`.
//
//   ipc_slow   - one record per call at or over the threshold (300 ms DEV,
//                1000 ms PROD).
//   ipc_window - DEV only: per command, the calls settled since the previous
//                flush, folded in a small accumulator (never a scan of the
//                500-ring) and drained into each flush.
//
// `devlog_ingest` itself never reaches this module: `tauriInvoke.ts` skips it
// before calling `observeIpcSettle`, so a flush cannot report on itself.
// ---------------------------------------------------------------------------

import { percentile } from '@/lib/ipcMetrics';
import {
  PROD_IPC_SLOW_MS,
  devlog,
  isProdBuild,
  registerDevlogContributor,
  requestDevlogFlush,
  type DevlogInput,
} from './buffer';
import { errorKindOf } from './errors';

export const DEV_IPC_SLOW_MS = 300;
/** Duration samples kept per command per window; counts stay exact past it. */
const WINDOW_SAMPLE_CAP = 256;

export function ipcSlowThresholdMs(): number {
  return isProdBuild() ? PROD_IPC_SLOW_MS : DEV_IPC_SLOW_MS;
}

export interface IpcSettle {
  command: string;
  durationMs: number;
  ok: boolean;
  timedOut: boolean;
  error?: unknown;
}

/** The `ipc_slow` record for a settle, or null when it is under the threshold. */
export function ipcSlowRecord(s: IpcSettle): DevlogInput | null {
  if (s.durationMs < ipcSlowThresholdMs()) return null;
  return {
    kind: 'ipc_slow',
    lvl: 'warn',
    scope: 'ipc',
    msg: 'slow ipc call',
    fields: {
      command: s.command,
      duration_ms: Math.round(s.durationMs),
      ok: s.ok,
      timed_out: s.timedOut,
      error_kind: s.ok ? undefined : errorKindOf(s.error),
    },
  };
}

// --- per-window accumulator (DEV) -------------------------------------------

interface WindowStat {
  count: number;
  samples: number[];
  maxMs: number;
  errors: number;
  timeouts: number;
}

const windowByCommand = new Map<string, WindowStat>();

export function accumulateIpcWindow(s: IpcSettle): void {
  let stat = windowByCommand.get(s.command);
  if (!stat) {
    stat = { count: 0, samples: [], maxMs: 0, errors: 0, timeouts: 0 };
    windowByCommand.set(s.command, stat);
  }
  stat.count += 1;
  if (stat.samples.length < WINDOW_SAMPLE_CAP) stat.samples.push(s.durationMs);
  if (s.durationMs > stat.maxMs) stat.maxMs = s.durationMs;
  if (!s.ok) stat.errors += 1;
  if (s.timedOut) stat.timeouts += 1;
}

/** One `ipc_window` record per command seen since the last drain; resets the window. */
export function drainIpcWindow(): DevlogInput[] {
  const out: DevlogInput[] = [];
  for (const [command, stat] of windowByCommand) {
    const sorted = stat.samples.slice().sort((a, b) => a - b);
    out.push({
      kind: 'ipc_window',
      lvl: 'debug',
      scope: 'ipc',
      msg: 'ipc window',
      fields: {
        command,
        count: stat.count,
        p50_ms: Math.round(percentile(sorted, 50)),
        p95_ms: Math.round(percentile(sorted, 95)),
        max_ms: Math.round(stat.maxMs),
        errors: stat.errors,
        timeouts: stat.timeouts,
      },
    });
  }
  windowByCommand.clear();
  return out;
}

if (import.meta.env.DEV) registerDevlogContributor(drainIpcWindow);

/** Called once per settled `invokeWithTimeout` call (except `devlog_ingest`). */
export function observeIpcSettle(s: IpcSettle): void {
  const slow = ipcSlowRecord(s);
  if (slow) devlog(slow);
  if (import.meta.env.DEV) {
    accumulateIpcWindow(s);
    requestDevlogFlush();
  }
}
