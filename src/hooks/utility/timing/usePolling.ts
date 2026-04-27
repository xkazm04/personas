import { useEffect, useRef, useState, useCallback } from 'react';

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
 * - Manages setInterval lifecycle tied to `enabled`.
 * - Pauses when the browser tab is hidden (`document.visibilityState`).
 * - Applies exponential backoff on consecutive errors.
 * - Fires immediately on enable, then at `interval` thereafter.
 */
export function usePolling(
  fetchFn: () => unknown | Promise<unknown>,
  { interval, enabled, maxBackoff }: PollingOptions,
): PollingState {
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const errorCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef<() => unknown | Promise<unknown>>(fetchFn);
  fetchRef.current = fetchFn;

  const effectiveMaxBackoff = maxBackoff ?? interval * 4;

  const runFetch = useCallback(async () => {
    try {
      await fetchRef.current();
      errorCountRef.current = 0;
      setLastRefreshed(Date.now());
    } catch {
      errorCountRef.current++;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const getDelay = () => {
      if (errorCountRef.current === 0) return interval;
      const backoff = interval * Math.pow(2, errorCountRef.current);
      return Math.min(backoff, effectiveMaxBackoff);
    };

    let stopped = false;
    let visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // Recursive setTimeout instead of setInterval. setInterval evaluated
    // getDelay() ONCE at scheduling time, so the exponential backoff was a
    // no-op while a polling cycle was alive — during a sustained backend
    // outage the hook kept hammering the API at the original 5s/12s/15s
    // cadence and could trip rate limits (esp. self-hosted GitLab). Now
    // each tick awaits runFetch() then recomputes the delay against the
    // current errorCountRef before scheduling the next tick.
    const tick = async () => {
      if (stopped || !visible) return;
      await runFetch();
      if (stopped) return;
      timeoutId = setTimeout(() => { void tick(); }, getDelay());
      // Mirror to timerRef so external code that inspects it still works
      // (the existing clear() logic is gone but kept the same ref shape).
      timerRef.current = timeoutId as unknown as ReturnType<typeof setInterval>;
    };

    const clear = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      timerRef.current = null;
    };

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (visible) {
        void tick();
      } else {
        clear();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (visible) void tick();

    return () => {
      stopped = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, interval, effectiveMaxBackoff, runFetch]);

  return { isPolling: enabled, lastRefreshed };
}
