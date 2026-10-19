/**
 * useSystemTrace -- reactive hook to access system-wide trace sessions.
 *
 * Subscribes to the in-memory system trace registry and re-renders
 * when sessions start, update, or complete.
 */
import { useSyncExternalStore, useCallback, useMemo } from 'react';
import {
  getAllSystemTraces,
  clearCompletedTraces,
  onSystemTraceChange,
  type SystemTrace,
} from '@/lib/execution/systemTrace';

let _snapshot: SystemTrace[] = getAllSystemTraces();

/**
 * `useSyncExternalStore` re-renders on snapshot IDENTITY, so a notify that
 * changed nothing must not produce a new array -- otherwise every subscriber
 * re-renders on every unrelated notify. Trace objects are immutable snapshots
 * and a span mutation replaces the span object, so element identity is a
 * sufficient and cheap comparison.
 */
function sameTraces(a: SystemTrace[], b: SystemTrace[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((trace, i) => {
    const other = b[i];
    if (!other) return false;
    if (trace === other) return true;
    if (trace.traceId !== other.traceId) return false;
    if (trace.completedAt !== other.completedAt) return false;
    if (trace.spans.length !== other.spans.length) return false;
    return trace.spans.every((span, j) => span === other.spans[j]);
  });
}

/**
 * Keep `_snapshot` current for the life of the module, mounted or not.
 *
 * The snapshot used to be refreshed only inside a mounted subscriber's
 * listener, so every trace recorded while no panel was open (the design and
 * template flows that start sessions live on other pages) left it stale, and
 * the Observability panel then mounted onto that stale array and showed it
 * until some later trace event happened to notify. Registered once, first, so
 * it runs before any React subscriber reads the snapshot.
 */
function refreshSnapshot(): void {
  const next = getAllSystemTraces();
  // Hold the old array when nothing changed; React then compares the two
  // getSnapshot results and skips the re-render itself.
  _snapshot = sameTraces(_snapshot, next) ? _snapshot : next;
}
onSystemTraceChange(refreshSnapshot);

function subscribe(callback: () => void): () => void {
  return onSystemTraceChange(callback);
}

function getSnapshot(): SystemTrace[] {
  return _snapshot;
}

export function useSystemTraces() {
  const traces = useSyncExternalStore(subscribe, getSnapshot);

  const activeCount = useMemo(
    () => traces.filter((t) => !t.completedAt).length,
    [traces],
  );

  const errorCount = useMemo(
    () =>
      traces.reduce(
        (acc, t) => acc + t.spans.filter((s) => s.error).length,
        0,
      ),
    [traces],
  );

  const clear = useCallback(() => {
    clearCompletedTraces();
  }, []);

  return { traces, activeCount, errorCount, clear };
}
