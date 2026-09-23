/**
 * The month bucketing moved out of LimitsSettings so the tab and the
 * always-mounted spend watcher cannot disagree about "this month". This guard
 * pins the lifted function to what the tab's own loop (LimitsSettings.tsx:133-158
 * before the lift) produced for the same points: five rows, descending, the
 * head anchored on the newest chart date rather than the client clock.
 */
import { describe, it, expect } from 'vitest';
import { bucketMonthlySpend } from '../monthlySpend';

describe('bucketMonthlySpend', () => {
  it('case 8 [guard]: 5 rows anchored on the max chart date, sums identical to the old loop', () => {
    const points = [
      { date: '2026-05-20', cost: 1.5 },
      { date: '2026-06-01', cost: 2 },
      { date: '2026-06-30', cost: 0.25 },
      { date: '2026-07-15', cost: 3 },
      { date: '2026-08-31', cost: 4.125 },
      { date: '2026-09-01', cost: 0.5 },
      { date: '2026-09-02', cost: 0.75 },
    ];
    const rows = bucketMonthlySpend(points);
    expect(rows.map((r) => [r.key, r.spend])).toEqual([
      ['2026-09', 1.25],
      ['2026-08', 4.125],
      ['2026-07', 3],
      ['2026-06', 2.25],
      ['2026-05', 1.5],
    ]);
    for (const r of rows) expect(r.label.length).toBeGreaterThan(0);
  });

  it('case 8 [guard]: the head is the newest data month even when a month in between is empty', () => {
    const rows = bucketMonthlySpend([
      { date: '2026-09-02', cost: 2 },
      { date: '2026-06-10', cost: 1 },
    ]);
    expect(rows.map((r) => [r.key, r.spend])).toEqual([
      ['2026-09', 2],
      ['2026-08', 0],
      ['2026-07', 0],
      ['2026-06', 1],
      ['2026-05', 0],
    ]);
  });
});
