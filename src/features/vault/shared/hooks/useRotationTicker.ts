import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';

/**
 * Subscribe to the rotation countdown ticker.
 *
 * Returns a tick counter that increments every 60 seconds, causing a re-render.
 * Use `formatCountdown` to derive the display string from a `next_rotation_at`
 * timestamp.
 *
 * Backed by the app-wide shared ticker (see `relativeTimeTicker`), so credential
 * countdowns coalesce onto the same timer as every other relative-time label
 * instead of spinning a dedicated 60s interval.
 */
export function useRotationTicker(): number {
  return useFixedTicker(60_000);
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
