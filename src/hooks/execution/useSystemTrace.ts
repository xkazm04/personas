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

function subscribe(callback: () => void): () => void {
  return onSystemTraceChange(() => {
    _snapshot = getAllSystemTraces();
    callback();
  });
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
