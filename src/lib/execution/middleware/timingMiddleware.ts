/**
 * Pipeline Stage Timing Middleware
 *
 * Collects per-stage performance.now() timings accumulated during execution
 * and persists them as metadata on the execution's pipeline trace. Logs a
 * summary to the console for developer visibility and emits the full timing
 * record via StoreBus for downstream consumers (dashboards, analytics).
 *
 * Stage: frontend_complete (runs after all stages have been timed)
 */

import { addMiddleware, type PipelineMiddleware } from '@/lib/execution/pipeline';
import { getTimingRecord, clearTimingRecord } from '@/lib/execution/pipeline';
import { createLogger } from '@/lib/log';

const logger = createLogger('timing-middleware');

const timingMiddleware: PipelineMiddleware<'frontend_complete'> = async (
  _stage,
  payload,
  _trace,
) => {
  const { executionId } = payload;
  if (!executionId) return payload;

  const record = getTimingRecord(executionId);
  if (!record || record.stages.length === 0) return payload;

  // Log a human-readable summary for developer debugging
  const lines = record.stages.map(
    (s) => `  ${s.stage}: ${s.durationMs != null ? `${s.durationMs.toFixed(1)}ms` : 'open'}`,
  );
  logger.info('Pipeline stage timings', {
    executionId,
    totalMs: record.totalMs != null ? `${record.totalMs.toFixed(1)}ms` : 'n/a',
    stages: '\n' + lines.join('\n'),
  });

  // Persist timing data into localStorage keyed by execution ID.
  // This allows the observability dashboard to retrieve timings for
  // recent executions without requiring a backend round-trip.
  try {
    const key = `personas:stage-timings:${executionId}`;
    const serializable = record.stages.map((s) => ({
      stage: s.stage,
      durationMs: s.durationMs != null ? Math.round(s.durationMs * 100) / 100 : null,
    }));
    localStorage.setItem(key, JSON.stringify({
      executionId,
      totalMs: record.totalMs != null ? Math.round(record.totalMs * 100) / 100 : null,
      stages: serializable,
      recordedAt: Date.now(),
    }));

    // Prune old timing entries (keep last 50 executions)
    _pruneTimingEntries(50);
  } catch {
    // localStorage full or unavailable -- non-critical
  }

  // Clean up in-memory timing data
  clearTimingRecord(executionId);

  return payload;
};

/** Remove oldest timing entries beyond `maxEntries`. */
function _pruneTimingEntries(maxEntries: number): void {
  const prefix = 'personas:stage-timings:';
  const keys: { key: string; recordedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key) ?? '{}');
      keys.push({ key, recordedAt: data.recordedAt ?? 0 });
    } catch {
      keys.push({ key, recordedAt: 0 });
    }
  }
  if (keys.length <= maxEntries) return;
  keys.sort((a, b) => a.recordedAt - b.recordedAt);
  const toRemove = keys.slice(0, keys.length - maxEntries);
  for (const { key } of toRemove) {
    localStorage.removeItem(key);
  }
}

export function registerTimingMiddleware(): void {
  addMiddleware(
    'frontend_complete',
    { key: 'stage-timing', priority: 5 },
    timingMiddleware,
  );
}
