/**
 * Compare mode cut a `2 × days` series at `points.length - periodDays` and
 * zipped the halves by ordinal index. That is only correct when every calendar
 * day produced a row — and the daily rollup emits rows only for days with
 * activity. A window with three quiet days cut three days late, so the ghost
 * line labelled "previous period" was drawn from the CURRENT period's own
 * earliest days, and drawn against the wrong dates.
 */
import { describe, it, expect } from 'vitest';
import { mergePreviousPeriod } from '../periodComparison';
import { splitComparisonPeriods } from '@/features/overview/libs/computeTrends';
import { daysEndingAt, shiftDay, latestDay, isIsoDay } from '@/features/overview/libs/periodWindow';

type Row = Record<string, string | number>;
const row = (rawDate: string, cost: number): Row => ({ rawDate, date: rawDate.slice(5), cost });

describe('periodWindow', () => {
  it('counts a closed window ending at the day the user is looking at', () => {
    expect(daysEndingAt('2026-09-10', 3)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(daysEndingAt('2026-09-10', 0)).toEqual([]);
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('rejects anything that is not a bare day key', () => {
    expect(isIsoDay('2026-09-10')).toBe(true);
    expect(isIsoDay('Sep 10')).toBe(false);
    expect(isIsoDay('2026-09-10T00:00:00Z')).toBe(false);
    expect(isIsoDay(undefined)).toBe(false);
    expect(latestDay(['Sep 10', undefined])).toBeNull();
  });
});

describe('mergePreviousPeriod — calendar alignment', () => {
  it('takes the previous value from exactly one period earlier', () => {
    // 6 days: 3 prior + 3 current, all present.
    const points = [
      row('2026-09-05', 1), row('2026-09-06', 2), row('2026-09-07', 3),
      row('2026-09-08', 10), row('2026-09-09', 20), row('2026-09-10', 30),
    ];

    const out = mergePreviousPeriod(points, 3, ['cost']);

    expect(out.map((r) => r.rawDate)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(out.map((r) => r.prev_cost)).toEqual([1, 2, 3]);
  });

  it('does not let a quiet current day drag the previous period forward', () => {
    // Current window has a gap on 09-09. The ordinal split would have cut one
    // day late and paired 09-10 with 09-07 — a day inside the CURRENT period.
    const points = [
      row('2026-09-05', 1), row('2026-09-06', 2), row('2026-09-07', 3),
      row('2026-09-08', 10), /* 09-09 quiet */ row('2026-09-10', 30),
    ];

    const out = mergePreviousPeriod(points, 3, ['cost']);

    expect(out.map((r) => r.rawDate)).toEqual(['2026-09-08', '2026-09-10']);
    expect(out.find((r) => r.rawDate === '2026-09-10')!.prev_cost).toBe(3);
    expect(out.find((r) => r.rawDate === '2026-09-08')!.prev_cost).toBe(1);
  });

  it('omits prev_* for a current day whose counterpart was quiet, rather than packing the next bucket', () => {
    const points = [
      row('2026-09-05', 1), /* 09-06 quiet */ row('2026-09-07', 3),
      row('2026-09-08', 10), row('2026-09-09', 20), row('2026-09-10', 30),
    ];

    const out = mergePreviousPeriod(points, 3, ['cost']);
    const sept9 = out.find((r) => r.rawDate === '2026-09-09')!;

    expect(sept9.prev_cost).toBeUndefined();
    expect(out.find((r) => r.rawDate === '2026-09-10')!.prev_cost).toBe(3);
  });

  it('fills the calendar when the caller supplies a placeholder factory', () => {
    const points = [
      row('2026-09-05', 1), row('2026-09-06', 2), row('2026-09-07', 3),
      row('2026-09-08', 10), /* 09-09 quiet */ row('2026-09-10', 30),
    ];

    const out = mergePreviousPeriod(points, 3, ['cost'], {
      makeEmptyRow: (day) => ({ rawDate: day, date: day.slice(5), cost: 0 }),
    });

    expect(out.map((r) => r.rawDate)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(out[1]!.cost).toBe(0);
    // The filled day still gets its real counterpart.
    expect(out[1]!.prev_cost).toBe(2);
  });

  it('honours an explicit end date over the newest observed day', () => {
    const points = [row('2026-09-05', 1), row('2026-09-06', 2), row('2026-09-07', 3), row('2026-09-08', 10)];

    const out = mergePreviousPeriod(points, 2, ['cost'], { endDate: '2026-09-07' });

    expect(out.map((r) => r.rawDate)).toEqual(['2026-09-06', '2026-09-07']);
    expect(out.map((r) => r.prev_cost)).toEqual([undefined, 1]);
  });

  it('carries every requested numeric key and skips non-numeric ones', () => {
    const points = [
      { rawDate: '2026-09-09', date: 'x', cost: 1, note: 'a' },
      { rawDate: '2026-09-10', date: 'y', cost: 9, note: 'b' },
    ];

    const out = mergePreviousPeriod(points, 1, ['cost', 'note']);

    expect(out[0]!.prev_cost).toBe(1);
    expect(out[0]!.prev_note).toBeUndefined();
  });

  it('returns [] for an empty series', () => {
    expect(mergePreviousPeriod([], 7, ['cost'])).toEqual([]);
  });

  it('falls back to the ordinal split when rows carry no day key', () => {
    const points: Row[] = [
      { date: 'a', cost: 1 }, { date: 'b', cost: 2 },
      { date: 'c', cost: 10 }, { date: 'd', cost: 20 },
    ];

    const out = mergePreviousPeriod(points, 2, ['cost']);

    expect(out.map((r) => r.date)).toEqual(['c', 'd']);
    expect(out.map((r) => r.prev_cost)).toEqual([1, 2]);
  });
});

describe('splitComparisonPeriods — the same calendar, one helper', () => {
  const rows = [
    row('2026-09-05', 1), row('2026-09-06', 2), row('2026-09-07', 3),
    row('2026-09-08', 10), /* 09-09 quiet */ row('2026-09-10', 30),
  ];

  it('splits on the calendar when a day accessor is supplied', () => {
    const split = splitComparisonPeriods(rows, 3, true, (r) => r.rawDate)!;

    expect(split.current.map((r) => r.rawDate)).toEqual(['2026-09-08', '2026-09-10']);
    expect(split.previous.map((r) => r.rawDate)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
  });

  it('would have stolen a current day without the accessor — the defect, pinned', () => {
    const ordinal = splitComparisonPeriods(rows, 3, true)!;

    // 09-07 belongs to the PRIOR period but the ordinal split calls it current.
    expect(ordinal.current.map((r) => r.rawDate)).toContain('2026-09-07');
  });

  it('still refuses to invent a comparison', () => {
    expect(splitComparisonPeriods(rows, 3, false, (r) => r.rawDate)).toBeNull();
    expect(splitComparisonPeriods([], 3, true, (r: Row) => r.rawDate)).toBeNull();
    // A window that is entirely the current period has no prior half.
    expect(splitComparisonPeriods(rows, 30, true, (r) => r.rawDate)).toBeNull();
  });

  it('keeps working over a plain numeric series, which has no dates to read', () => {
    const split = splitComparisonPeriods([1, 2, 3, 4], 2, true)!;

    expect(split.previous).toEqual([1, 2]);
    expect(split.current).toEqual([3, 4]);
  });
});
