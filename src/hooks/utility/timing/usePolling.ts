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

/**
 * Why the loop is not currently running.
 *
 * `hidden` - the tab is in the background and the coordinator has suspended
 * the bucket. `backoff` - the last cycle threw and ticks are being skipped
 * until `nextEligibleAt`. `null` - live, or disabled by the caller.
 */
export type PollingPausedReason = 'hidden' | 'backoff' | null;

export interface PollingState {
  /** True while the loop is actually eligible to fire: enabled, visible, not backing off. */
  isPolling: boolean;
  /** Timestamp of the last successful fetch (null until first success). */
  lastRefreshed: number | null;
  /**
   * The error from the most recent failed cycle, cleared on the next success.
   *
   * The failure used to be swallowed here AND in the coordinator's own
   * `runTicker`, so a wedged poller was indistinguishable from an idle one and
   * each panel had to invent its own `stale` flag (and rethrow from its fetch)
   * to notice. A Live dot can now read one contract instead.
   */
  lastError: unknown;
  /** Consecutive failed cycles; 0 after any success. */
  consecutiveErrors: number;
  /** Epoch ms before which ticks are skipped. 0 when not backing off. */
  nextEligibleAt: number;
  /** Distinguishes a background pause from an error backoff. */
  pausedReason: PollingPausedReason;
}

interface PollingStatus {
  lastRefreshed: number | null;
  lastError: unknown;
  consecutiveErrors: number;
  nextEligibleAt: number;
}

const INITIAL_STATUS: PollingStatus = {
  lastRefreshed: null,
  lastError: null,
  consecutiveErrors: 0,
  nextEligibleAt: 0,
};

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
  const [status, setStatus] = useState<PollingStatus>(INITIAL_STATUS);
  const isDocumentVisible = useDocumentVisibility();
  const errorCountRef = useRef(0);
  // The predicate the coordinator calls is synchronous and runs between
  // renders, so the eligibility stamp stays on a ref; the state copy below is
  // the same value, published for rendering.
  const nextEligibleAtRef = useRef(0);
  const fetchRef = useRef<() => unknown | Promise<unknown>>(fetchFn);
  fetchRef.current = fetchFn;

  const effectiveMaxBackoff = maxBackoff ?? interval * 4;

  const runFetch = useCallback(async () => {
    try {
      await fetchRef.current();
      errorCountRef.current = 0;
      nextEligibleAtRef.current = 0;
      setStatus({
        lastRefreshed: Date.now(),
        lastError: null,
        consecutiveErrors: 0,
        nextEligibleAt: 0,
      });
    } catch (err) {
      errorCountRef.current++;
      const backoff = Math.min(
        interval * Math.pow(2, errorCountRef.current),
        effectiveMaxBackoff,
      );
      // Skip ticks until this timestamp; bucket keeps firing for other
      // tickers, so we don't desynchronize the heartbeat.
      nextEligibleAtRef.current = Date.now() + backoff;
      const nextEligibleAt = nextEligibleAtRef.current;
      const consecutiveErrors = errorCountRef.current;
      // `lastRefreshed` is deliberately withheld: a failed cycle did not
      // refresh anything, and advancing the stamp is what let a green Live dot
      // sit over the last good snapshot.
      setStatus((prev) => ({
        lastRefreshed: prev.lastRefreshed,
        lastError: err,
        consecutiveErrors,
        nextEligibleAt,
      }));
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

  const backingOff = status.nextEligibleAt > Date.now();
  const pausedReason: PollingPausedReason = !enabled
    ? null
    : !isDocumentVisible
      ? 'hidden'
      : backingOff
        ? 'backoff'
        : null;

  return {
    isPolling: enabled && isDocumentVisible && !backingOff,
    lastRefreshed: status.lastRefreshed,
    lastError: status.lastError,
    consecutiveErrors: status.consecutiveErrors,
    nextEligibleAt: status.nextEligibleAt,
    pausedReason,
  };
}
