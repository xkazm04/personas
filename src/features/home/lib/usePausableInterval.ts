import { useEffect, useRef } from 'react';

/**
 * A `setInterval` that runs only while the surface is "live" — i.e. `active`
 * (the caller's own condition, typically "this Home tab is the visible one")
 * AND the document is visible. It pauses when the user navigates away or hides
 * the window, and resumes on return.
 *
 * Why this exists: Home surfaces stay mounted under the keep-alive HomePage, so
 * a naive `setInterval` would keep polling the backend for a tab the user isn't
 * looking at (and while the window is in the background). FleetHealthStrip's 30s
 * metrics poll and the live-roadmap hourly poll both use this to go quiet when
 * off-screen.
 *
 * Refresh-on-return: the callback fires immediately when the surface RE-activates
 * (returning to the tab) or becomes visible again — so stale data is refreshed
 * without waiting a full interval. It does NOT fire on the very first mount; the
 * consumer is expected to do its own initial load there. All callbacks passed in
 * are expected to be cheap/idempotent (TTL- or cache-guarded).
 */
export function usePausableInterval(
  callback: () => void,
  intervalMs: number,
  active: boolean,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  // Whether the interval has ever started for this component. Distinguishes the
  // first mount (don't double-fire the consumer's initial load) from a genuine
  // re-activation (do refresh).
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    let id: number | undefined;
    const tick = () => cbRef.current();
    const start = () => {
      if (id == null && !document.hidden) id = window.setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (id != null) {
        window.clearInterval(id);
        id = undefined;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        tick(); // refresh on becoming visible again
        start();
      }
    };

    // Refresh immediately when re-activating (returning to this tab), but not on
    // the very first mount — the consumer owns the initial load there.
    if (startedRef.current) tick();
    startedRef.current = true;

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, intervalMs]);
}
