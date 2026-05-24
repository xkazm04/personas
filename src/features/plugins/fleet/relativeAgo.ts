import { useEffect, useState } from 'react';
import type { Translations } from '@/i18n/generated/types';
import { interpolate } from '@/i18n/useTranslation';

/**
 * A `now` timestamp that re-renders the caller on an interval, so relative
 * "Xs ago" labels stay fresh without each row owning its own timer. Default
 * 30s cadence — fine-grained enough for "how long has this been waiting?"
 * without churning the grid.
 */
export function useNowTick(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Compact relative-time label ("just now" / "5s ago" / "3m ago" / "2h ago"). */
export function formatAgo(t: Translations, fromMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  if (s < 10) return t.plugins.fleet.ago_just_now;
  if (s < 60) return interpolate(t.plugins.fleet.ago_seconds, { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return interpolate(t.plugins.fleet.ago_minutes, { n: m });
  const h = Math.floor(m / 60);
  return interpolate(t.plugins.fleet.ago_hours, { n: h });
}
