import { describe, it, expect } from 'vitest';
import { timeGroupKey, timeGroupLabels, buildGroupRows, type GroupSpec } from '../grouping';

// Fixed "now": Thu 2026-05-28 14:00 local. getDay() === 4 (Thursday), so the
// most-recent-Sunday anchor for "this week" is 2026-05-24 00:00.
const NOW = new Date(2026, 4, 28, 14, 0, 0);

describe('timeGroupKey', () => {
  it('buckets a same-day timestamp as today', () => {
    expect(timeGroupKey(new Date(2026, 4, 28, 1, 0, 0), NOW)).toBe('today');
    expect(timeGroupKey(new Date(2026, 4, 28, 23, 59, 0), NOW)).toBe('today');
  });

  it('buckets the prior calendar day as yesterday', () => {
    expect(timeGroupKey(new Date(2026, 4, 27, 23, 0, 0), NOW)).toBe('yesterday');
  });

  it('buckets earlier days of the current week as this_week', () => {
    // Sunday 2026-05-24 is the week anchor; Mon/Tue fall in this_week.
    expect(timeGroupKey(new Date(2026, 4, 25, 9, 0, 0), NOW)).toBe('this_week');
    expect(timeGroupKey(new Date(2026, 4, 24, 0, 0, 0), NOW)).toBe('this_week');
  });

  it('buckets earlier-this-month dates as this_month', () => {
    expect(timeGroupKey(new Date(2026, 4, 10, 9, 0, 0), NOW)).toBe('this_month');
    expect(timeGroupKey(new Date(2026, 4, 1, 0, 0, 0), NOW)).toBe('this_month');
  });

  it('buckets prior months as older', () => {
    expect(timeGroupKey(new Date(2026, 3, 30, 23, 0, 0), NOW)).toBe('older');
    expect(timeGroupKey(new Date(2025, 0, 1, 0, 0, 0), NOW)).toBe('older');
  });

  it('accepts ISO strings and epoch millis', () => {
    expect(timeGroupKey('2026-05-28T01:00:00', NOW)).toBe('today');
    expect(timeGroupKey(new Date(2026, 4, 27, 12, 0, 0).getTime(), NOW)).toBe('yesterday');
  });

  it('falls back to older for unparseable input', () => {
    expect(timeGroupKey('not-a-date', NOW)).toBe('older');
  });
});

describe('timeGroupLabels', () => {
  it('maps each key to its shared translation', () => {
    const t = {
      shared: {
        group_today: 'Today',
        group_yesterday: 'Yesterday',
        group_this_week: 'This week',
        group_this_month: 'This month',
        group_older: 'Older',
      },
    };
    expect(timeGroupLabels(t)).toEqual({
      today: 'Today',
      yesterday: 'Yesterday',
      this_week: 'This week',
      this_month: 'This month',
      older: 'Older',
    });
  });
});

describe('buildGroupRows', () => {
  const groupOf = (n: { g: string }): GroupSpec => ({ key: n.g, label: n.g.toUpperCase() });

  it('returns no rows for an empty list', () => {
    const { rows, headerIndexes } = buildGroupRows([], groupOf);
    expect(rows).toEqual([]);
    expect(headerIndexes).toEqual([]);
  });

  it('inserts one header per consecutive run and tracks counts', () => {
    const items = [{ g: 'a' }, { g: 'a' }, { g: 'b' }, { g: 'c' }, { g: 'c' }, { g: 'c' }];
    const { rows, headerIndexes } = buildGroupRows(items, groupOf);

    // header, a, a, header, b, header, c, c, c  → 9 rows
    expect(rows).toHaveLength(9);
    expect(headerIndexes).toEqual([0, 3, 5]);

    expect(rows[0]).toMatchObject({ kind: 'header', key: 'a', label: 'A', count: 2 });
    expect(rows[3]).toMatchObject({ kind: 'header', key: 'b', count: 1 });
    expect(rows[5]).toMatchObject({ kind: 'header', key: 'c', count: 3 });
  });

  it('preserves the original index on item rows for stable striping', () => {
    const items = [{ g: 'a' }, { g: 'b' }];
    const { rows } = buildGroupRows(items, groupOf);
    const itemRows = rows.filter((r) => r.kind === 'item');
    expect(itemRows.map((r) => (r.kind === 'item' ? r.dataIndex : -1))).toEqual([0, 1]);
  });

  it('emits a fresh header each time a key recurs non-adjacently', () => {
    // Not globally sorted by key — the run-based grouping marks each run.
    const items = [{ g: 'a' }, { g: 'b' }, { g: 'a' }];
    const { rows, headerIndexes } = buildGroupRows(items, groupOf);
    expect(headerIndexes).toEqual([0, 2, 4]);
    expect(rows.filter((r) => r.kind === 'header')).toHaveLength(3);
  });
});
