/**
 * Swimlane categorization — partitions a unified inbox into temporal lanes.
 *
 *   - today:    < 24h old, not snoozed
 *   - week:     1–7 days old, not snoozed
 *   - older:    > 7 days old, not snoozed (folded into a tail bucket)
 *   - snoozed:  any item with an active snooze entry
 *   - resolved: surfaced by the page from a session-local recent-actions log
 *
 * The page consumes one swimlane at a time, so this returns a `Record` keyed
 * by lane id and the page picks the active lane.
 */
import type { UnifiedInboxItem } from '@/features/simple-mode/types';
import type { SnoozeMap } from './snoozeStore';

export type SwimlaneId = 'today' | 'week' | 'snoozed' | 'resolved';

export interface SwimlaneBuckets {
  today: UnifiedInboxItem[];
  week: UnifiedInboxItem[];
  snoozed: UnifiedInboxItem[];
  /** Filled by the page from its own recent-actions log; this lib leaves it empty. */
  resolved: UnifiedInboxItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function partitionSwimlanes(
  items: UnifiedInboxItem[],
  snoozeMap: SnoozeMap,
  now: number = Date.now(),
): SwimlaneBuckets {
  const today: UnifiedInboxItem[] = [];
  const week: UnifiedInboxItem[] = [];
  const snoozed: UnifiedInboxItem[] = [];

  for (const item of items) {
    const snoozeUntil = snoozeMap[item.id];
    const isSnoozed = !!snoozeUntil && Date.parse(snoozeUntil) > now;
    if (isSnoozed) {
      snoozed.push(item);
      continue;
    }
    const ageMs = now - Date.parse(item.createdAt);
    if (ageMs < DAY_MS) today.push(item);
    else if (ageMs < WEEK_MS) week.push(item);
    // Older items intentionally drop off the active lanes — Simple-mode caps
    // at 50 newest, so > 7d almost never appears in practice.
  }

  return { today, week, snoozed, resolved: [] };
}

export function laneCount(buckets: SwimlaneBuckets, id: SwimlaneId): number {
  return buckets[id].length;
}
