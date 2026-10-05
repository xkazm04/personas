// ---------------------------------------------------------------------------
// Render-side producers (DEV only - probe-cost-budgeting keeps these
// instruments out of shipped builds).
//
//   long_task - PerformanceObserver('longtask'), >= 50 ms.
//   commit    - React <Profiler> commits (see SectionProfiler.tsx), >= 50 ms.
//
// The threshold logic is pure so it is testable without a browser timeline.
// ---------------------------------------------------------------------------

import type { ProfilerOnRenderCallback } from 'react';
import type { DevlogLevel } from '@/lib/bindings/DevlogLevel';
import { devlog, type DevlogInput } from './buffer';

export const LONG_TASK_MIN_MS = 50;
export const SLOW_COMMIT_MIN_MS = 50;
/** At or over this, a long task or commit is a warning rather than info. */
export const PERF_WARN_MS = 200;

/** Level for a measured duration, or null when it is under the floor. */
export function perfLevel(durationMs: number, floorMs: number): DevlogLevel | null {
  if (!(durationMs >= floorMs)) return null;
  return durationMs >= PERF_WARN_MS ? 'warn' : 'info';
}

export function longTaskRecord(durationMs: number, startMs: number): DevlogInput | null {
  const lvl = perfLevel(durationMs, LONG_TASK_MIN_MS);
  if (!lvl) return null;
  return {
    kind: 'long_task',
    lvl,
    scope: 'perf',
    msg: 'long task',
    fields: { duration_ms: Math.round(durationMs), start_ms: Math.round(startMs) },
  };
}

export function commitRecord(
  profilerId: string,
  phase: string,
  actualMs: number,
  baseMs: number,
): DevlogInput | null {
  const lvl = perfLevel(actualMs, SLOW_COMMIT_MIN_MS);
  if (!lvl) return null;
  return {
    kind: 'commit',
    lvl,
    scope: 'react',
    msg: 'slow react commit',
    fields: {
      profiler_id: profilerId,
      phase,
      duration_ms: Math.round(actualMs),
      base_ms: Math.round(baseMs),
    },
  };
}

/** `onRender` for the section Profilers. Only ever mounted in DEV. */
export const onDevlogCommit: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  const record = commitRecord(id, phase, actualDuration, baseDuration);
  if (record) devlog(record);
};

/**
 * Start the long-task observer. Returns its disconnect, or null when the
 * environment has no PerformanceObserver or no `longtask` entry type
 * (jsdom, older WebViews). Callers gate this on `import.meta.env.DEV`.
 */
export function startLongTaskObserver(): (() => void) | null {
  if (typeof PerformanceObserver === 'undefined') return null;
  const supported = PerformanceObserver.supportedEntryTypes;
  if (!Array.isArray(supported) || !supported.includes('longtask')) return null;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const record = longTaskRecord(entry.duration, entry.startTime);
        if (record) devlog(record);
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
    return () => observer.disconnect();
  } catch {
    // observe() can still throw on a partial implementation; no instrument then.
    return null;
  }
}
