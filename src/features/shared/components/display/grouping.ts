/**
 * grouping.ts — pure helpers for bucketing an ordered list into named groups
 * (Today / Yesterday / This week / This month / Older, or any category key) and
 * flattening it into a header+item row stream that a virtualizer can render with
 * sticky group headers.
 *
 * Intentionally React-free so the bucketing logic is unit-testable in isolation.
 * The rendering side lives in {@link ./GroupedVirtualList}.
 */

// ---------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------

export type TimeGroupKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'older';

const DAY_MS = 86_400_000;

/**
 * Map a timestamp to its relative time bucket. Mirrors the artist gallery's
 * `groupByDay` boundaries: today, yesterday, this-week (anchored at the most
 * recent Sunday), this-month, then everything older. Unparseable input falls
 * back to `older` so a bad row never breaks the stream.
 */
export function timeGroupKey(ts: number | string | Date, now: Date = new Date()): TimeGroupKey {
  const ms = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : Date.parse(ts);
  if (Number.isNaN(ms)) return 'older';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - DAY_MS;
  // Anchor "this week" at the most recent Sunday so the bucket matches what a
  // typical date picker shows; tweak if a Monday-start locale ever needs it.
  const startOfThisWeek = startOfToday - now.getDay() * DAY_MS;
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  if (ms >= startOfToday) return 'today';
  if (ms >= startOfYesterday) return 'yesterday';
  if (ms >= startOfThisWeek) return 'this_week';
  if (ms >= startOfThisMonth) return 'this_month';
  return 'older';
}

/** Minimal slice of the translation tree this module reads. */
export interface TimeGroupTranslations {
  shared: {
    group_today: string;
    group_yesterday: string;
    group_this_week: string;
    group_this_month: string;
    group_older: string;
  };
}

/** Resolve the localized label for each {@link TimeGroupKey}. */
export function timeGroupLabels(t: TimeGroupTranslations): Record<TimeGroupKey, string> {
  return {
    today: t.shared.group_today,
    yesterday: t.shared.group_yesterday,
    this_week: t.shared.group_this_week,
    this_month: t.shared.group_this_month,
    older: t.shared.group_older,
  };
}

// ---------------------------------------------------------------------------
// Row flattening
// ---------------------------------------------------------------------------

/** A group's stable key + display label, returned by the caller's `groupOf`. */
export interface GroupSpec {
  key: string;
  label: string;
}

/**
 * A flattened row: either a synthetic group header or a real data item carrying
 * its original index into the source array (so callers can keep index-derived
 * styling like zebra striping and accents stable per item).
 */
export type GroupRow<T> =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'item'; item: T; dataIndex: number };

/**
 * Flatten an ordered list into `[header, ...items, header, ...items]` by
 * inserting a header whenever the group key changes between adjacent items.
 *
 * This is a *consecutive-run* group-by, deliberately making no assumption that
 * the list is globally sorted by the group key: it inserts a header on every
 * key transition. When the list is already ordered by the grouping field (the
 * common case — chronological streams sorted by time) each key appears once, so
 * the result is identical to a global bucketing; when it is not, the headers
 * simply mark each run, which degrades gracefully instead of breaking.
 *
 * @returns the flattened rows and the flat indexes of the header rows (used by
 *          the virtualizer to keep the active header pinned).
 */
export function buildGroupRows<T>(
  items: readonly T[],
  groupOf: (item: T, index: number) => GroupSpec,
): { rows: GroupRow<T>[]; headerIndexes: number[] } {
  const rows: GroupRow<T>[] = [];
  const headerIndexes: number[] = [];
  let currentKey: string | null = null;
  let headerPos = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const spec = groupOf(item, i);
    if (spec.key !== currentKey) {
      currentKey = spec.key;
      headerPos = rows.length;
      headerIndexes.push(headerPos);
      rows.push({ kind: 'header', key: spec.key, label: spec.label, count: 0 });
    }
    (rows[headerPos] as { count: number }).count++;
    rows.push({ kind: 'item', item, dataIndex: i });
  }

  return { rows, headerIndexes };
}
