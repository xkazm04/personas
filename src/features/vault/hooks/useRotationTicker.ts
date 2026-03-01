import { useEffect, useReducer } from 'react';

/**
 * Module-level shared ticker that fires every 60 seconds.
 *
 * Instead of N independent setIntervals (one per credential card), all visible
 * cards subscribe to this single ticker and recompute their countdowns when it
 * fires. The ticker auto-starts when the first subscriber registers and
 * auto-stops when the last one unregisters.
 */

const subscribers = new Set<() => void>();
let tickerTimer: number | null = null;

function ensureTicker() {
  if (tickerTimer !== null) return;
  tickerTimer = window.setInterval(() => {
    for (const fn of subscribers) fn();
  }, 60_000);
}

function unregister(fn: () => void) {
  subscribers.delete(fn);
  if (subscribers.size === 0 && tickerTimer !== null) {
    clearInterval(tickerTimer);
    tickerTimer = null;
  }
}

/**
 * Subscribe to the shared rotation countdown ticker.
 *
 * Returns a tick counter that increments every 60 seconds, causing a re-render.
 * Use `formatCountdown` to derive the display string from a `next_rotation_at` timestamp.
 */
export function useRotationTicker(): number {
  const [tick, bump] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    subscribers.add(bump);
    ensureTicker();
    return () => unregister(bump);
  }, []);

  return tick;
}

/**
 * Pure function: compute a human-readable countdown string from an ISO timestamp.
 * Returns `null` if the timestamp is falsy.
 */
export function formatCountdown(nextRotationAt: string | null | undefined): string | null {
  if (!nextRotationAt) return null;
  const diff = Math.max(0, Math.floor((new Date(nextRotationAt).getTime() - Date.now()) / 1000));
  if (diff <= 0) return 'Due now';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
