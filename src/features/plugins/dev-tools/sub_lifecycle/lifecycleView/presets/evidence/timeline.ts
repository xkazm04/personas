// The change timeline's model: the outcome filter and the day each change
// falls on (local midnight, the zone injected for the test). Pure: no React,
// no i18n, no IO.
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import type { EvidenceRow } from '../../blocks/evidenceRows';
import { hostOffset, localDay, type OffsetOf } from './adherence';

export type OutcomeFilter = LifecycleOutcome | 'all';

export function filterRows(rows: readonly EvidenceRow[], filter: OutcomeFilter): EvidenceRow[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.outcome === filter);
}

/** Pressing the chip that is on turns the filter off. */
export function toggleFilter(current: OutcomeFilter, pressed: OutcomeFilter): OutcomeFilter {
  return current === pressed ? 'all' : pressed;
}

/** The local day number a change happened on; an unreadable time sorts to day 0. */
export function dayOfRow(row: EvidenceRow, offsetOf: OffsetOf = hostOffset): number {
  const ms = Date.parse(row.item.occurredAt);
  return Number.isNaN(ms) ? 0 : localDay(ms, offsetOf);
}
