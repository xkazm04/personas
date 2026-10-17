// The sheet keeps itself current: an adaptive re-read of the product, so a run that finished outside the sheet stops
// reading "running" without anyone pressing anything.
//
// The cadence rides the app's PollingCoordinator (one shared heartbeat per bucket, suspended while the window is
// hidden, fired once when it comes back). It is registered on the coordinator directly, not through `usePolling`,
// because that hook publishes a status object on every cycle, which would re-render the whole sheet each tick for a
// read that usually finds nothing; this hook holds no state.
//
// A read is an invalidation, not a render: `reload` keeps the previous `data` by identity when the read found
// nothing new (`mergeRead`), and drops a completion older than the newest read it started.
import { useEffect, useRef } from 'react';
import { getPollingCoordinator } from '@/lib/polling/pollingCoordinator';

/**
 * FAST while something is in flight (a store run is `running`, or a build this sheet started has not settled): 5 s is
 * the coordinator's finest bucket and the app's own "running executions" cadence, so a finished run shows within one
 * cycle without hammering the store's node process.
 */
export const FAST_MS = 5_000;
/** SLOW sweep otherwise: the safety net under the event-driven refreshes, 60 s is the coordinator's slowest bucket. */
export const SLOW_MS = 60_000;
/** No focus or visibility re-read when the last read finished under this long ago. */
export const THROTTLE_MS = 10_000;
/** A failing source is retried at most this far apart (doubling from the cadence), so a dead store is not hammered. */
const MAX_BACKOFF_MS = 60_000;

interface Deps {
  /** The sheet's reload; resolves false when the read failed. */
  reload: () => Promise<boolean>;
  /** When the last read finished, whoever asked for it. */
  readAt: { current: number };
  /** Is anything in flight right now? Picks the cadence. */
  fast: boolean;
}

export function useLiveRefresh({ reload, readAt, fast }: Deps): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const busy = useRef(false);
  const failures = useRef(0);
  const holdUntil = useRef(0);
  const interval = fast ? FAST_MS : SLOW_MS;

  useEffect(() => {
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const ok = await reloadRef.current();
        failures.current = ok ? 0 : failures.current + 1;
        holdUntil.current = ok ? 0 : Date.now() + Math.min(interval * 2 ** failures.current, MAX_BACKOFF_MS);
      } finally {
        busy.current = false;
      }
    };
    // a tick (and the coordinator's fire-on-register) skips when a read finished within half a cadence, capped at the
    // throttle: opening the sheet, a write's own reload and a quick hide/show do not buy a second read
    const quietFor = Math.min(THROTTLE_MS, interval / 2);
    const handle = getPollingCoordinator().register('blueprint:live', () => {
      if (Date.now() - readAt.current < quietFor) return;
      return run();
    }, { interval, shouldRun: () => Date.now() >= holdUntil.current });

    const back = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - readAt.current < THROTTLE_MS) return;
      void run();
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      handle.dispose();
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [interval, readAt]);
}
