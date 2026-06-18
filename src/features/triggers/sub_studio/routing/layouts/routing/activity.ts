/**
 * Activity scoring — reduce a list of recent PersonaEvent rows into a
 * per-event-type heartbeat that drives the row PulseDot, the "active within
 * 1h" filter, and the activity-sort mode.
 *
 * Kept pure so it can be memoised in the view.
 */
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { ActivityEntry } from './types';

export function buildActivityMap(events: PersonaEvent[]): Map<string, ActivityEntry> {
  const m = new Map<string, ActivityEntry>();
  for (const evt of events) {
    const tsNum = evt.created_at ? Date.parse(evt.created_at) : NaN;
    const tsValid = Number.isFinite(tsNum) ? tsNum : null;
    const cur = m.get(evt.event_type) ?? { count: 0, lastTs: null };
    cur.count += 1;
    if (tsValid !== null && (cur.lastTs === null || tsValid > cur.lastTs)) cur.lastTs = tsValid;
    m.set(evt.event_type, cur);
  }
  return m;
}

/** Compact "Xs / Xm / Xh / Xd / never" style for row-level time-ago display. */
export function formatAgo(ts: number | null): string {
  if (ts === null) return 'never';
  const delta = Date.now() - ts;
  if (delta < 0) return 'now';
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
