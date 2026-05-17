import { useEffect, useRef, useState, useCallback } from 'react';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import { getPollingCoordinator } from '@/lib/polling/pollingCoordinator';

// -- Polling configuration registry --------------------------------------
export const POLLING_CONFIG = {
  /** Running executions -- fast cadence while jobs are in-flight. */
  runningExecutions: { interval: 5_000, maxBackoff: 30_000 },
  /** Cloud review inbox -- moderate cadence for external sync. */
  cloudReviews: { interval: 15_000, maxBackoff: 60_000 },
  /** Analytics / observability auto-refresh -- slow cadence for dashboards. */
  dashboardRefresh: { interval: 30_000, maxBackoff: 120_000 },
  /** Cloud status panel -- live ops dashboard cadence. */
  cloudStatus: { interval: 12_000, maxBackoff: 60_000 },
  /** Cloud history panel -- slightly slower for heavier list+stats queries. */
  cloudHistory: { interval: 15_000, maxBackoff: 60_000 },
  /** GitLab pipeline refresh -- fast cadence while a pipeline is running/pending. */
  pipelineRefresh: { interval: 5_000, maxBackoff: 30_000 },
} as const;

export interface PollingOptions {
  /** Base interval in milliseconds. */
  interval: number;
  /** Whether polling is active. When false the timer is cleared. */
  enabled: boolean;
  /** Maximum backoff interval on consecutive errors (default: 4× interval). */
  maxBackoff?: number;
  /**
   * Optional human-readable name surfaced in coordinator stats for debugging.
   * Default: "polling". Pass a stable string per call site to keep stats useful.
   */
  name?: string;
}

export interface PollingState {
  /** True while a polling cycle is scheduled and the hook is active. */
  isPolling: boolean;
  /** Timestamp of the last successful fetch (null until first success). */
  lastRefreshed: number | null;
}

/**
 * Declarative polling hook.
 *
 * - Registers a ticker with the shared PollingCoordinator so all 30s/15s
 *   pollers fire on the same heartbeat instead of each owning a setTimeout.
 * - Pauses when the browser tab is hidden (the coordinator suspends every
 *   bucket on visibilitychange).
 * - Applies exponential backoff on consecutive errors via a predicate gate:
 *   the coordinator's bucket keeps firing on schedule, but this ticker's
 *   shouldRun() returns false until `nextEligibleAt` elapses. Backoff caps
 *   at `maxBackoff` (default 4× interval).
 * - Fires immediately on enable, then on each bucket tick thereafter.
 */
export function usePolling(
  fetchFn: () => unknown | Promise<unknown>,
  { interval, enabled, maxBackoff, name }: PollingOptions,
): PollingState {
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const isDocumentVisible = useDocumentVisibility();
  const errorCountRef = useRef(0);
  const nextEligibleAtRef = useRef(0);
  const fetchRef = useRef<() => unknown | Promise<unknown>>(fetchFn);
  fetchRef.current = fetchFn;

  const effectiveMaxBackoff = maxBackoff ?? interval * 4;

  const runFetch = useCallback(async () => {
    try {
      await fetchRef.current();
      errorCountRef.current = 0;
      nextEligibleAtRef.current = 0;
      setLastRefreshed(Date.now());
    } catch {
      errorCountRef.current++;
      const backoff = Math.min(
        interval * Math.pow(2, errorCountRef.current),
        effectiveMaxBackoff,
      );
      // Skip ticks until this timestamp; bucket keeps firing for other
      // tickers, so we don't desynchronize the heartbeat.
      nextEligibleAtRef.current = Date.now() + backoff;
    }
  }, [interval, effectiveMaxBackoff]);

  useEffect(() => {
    if (!enabled) return;
    const coord = getPollingCoordinator();
    const handle = coord.register(name ?? "polling", runFetch, {
      interval,
      shouldRun: () => Date.now() >= nextEligibleAtRef.current,
    });
    return () => handle.dispose();
  }, [enabled, interval, runFetch, name]);

  return { isPolling: enabled && isDocumentVisible, lastRefreshed };
}
