import { describe, expect, it } from 'vitest';

import { deriveShipVelocity, median, nextUnshipped, observedCycles } from '../shipVelocity';

import { milestone } from './shipFixtures';

/** A shipped milestone that took `days` from cut to ship. */
const shipped = (id: string, order: number, cut: string, days: number) => milestone({
  id, name: id, orderIndex: order, status: 'shipped',
  cutAt: `${cut}T00:00:00Z`,
  shippedAt: new Date(Date.parse(`${cut}T00:00:00Z`) + days * 86_400_000).toISOString(),
});

const NOW = new Date('2026-03-01T12:00:00Z');

describe('median', () => {
  it('takes the middle of an odd sample', () => {
    expect(median([10, 1, 5])).toBe(5);
  });
  it('averages the two middles of an even sample', () => {
    expect(median([10, 1, 5, 6])).toBe(5.5);
  });
});

describe('observedCycles', () => {
  it('counts only shipped milestones carrying BOTH stamps', () => {
    const rows = [
      shipped('a', 0, '2026-01-01', 10),
      milestone({ id: 'b', orderIndex: 1, status: 'shipped', cutAt: null, shippedAt: '2026-02-01T00:00:00Z' }),
      milestone({ id: 'c', orderIndex: 2, status: 'shipped', cutAt: '2026-02-01T00:00:00Z', shippedAt: null }),
      milestone({ id: 'd', orderIndex: 3, status: 'active' }),
    ];
    expect(observedCycles(rows)).toEqual([10]);
  });

  it('drops a row shipped before it was cut', () => {
    const bad = milestone({ id: 'x', status: 'shipped', cutAt: '2026-02-01T00:00:00Z', shippedAt: '2026-01-01T00:00:00Z' });
    expect(observedCycles([bad])).toEqual([]);
  });
});

describe('nextUnshipped', () => {
  it('prefers the active cut, then the lowest-ordered planned', () => {
    const rows = [
      milestone({ id: 'p2', orderIndex: 3, status: 'planned' }),
      milestone({ id: 'act', orderIndex: 2, status: 'active' }),
      milestone({ id: 'p1', orderIndex: 1, status: 'planned' }),
    ];
    expect(nextUnshipped(rows)?.id).toBe('act');
    expect(nextUnshipped(rows.filter((m) => m.status !== 'active'))?.id).toBe('p1');
  });

  it('is null when everything shipped', () => {
    expect(nextUnshipped([shipped('a', 0, '2026-01-01', 3)])).toBeNull();
  });
});

describe('deriveShipVelocity', () => {
  it('declines to forecast below the evidence bar', () => {
    expect(deriveShipVelocity([], NOW)).toBeNull();
    expect(deriveShipVelocity([shipped('a', 0, '2026-01-01', 10), milestone({ id: 'b', status: 'active' })], NOW)).toBeNull();
  });

  it('uses the median so one 90-day outlier cannot poison the forecast', () => {
    const rows = [
      shipped('a', 0, '2026-01-01', 10),
      shipped('b', 1, '2026-01-15', 12),
      shipped('c', 2, '2026-02-01', 90),
      milestone({ id: 'next', name: 'v4', orderIndex: 3, status: 'active', cutAt: '2026-02-20T00:00:00Z' }),
    ];
    const v = deriveShipVelocity(rows, NOW);
    // mean would be 37 days; median is 12
    expect(v?.medianDays).toBe(12);
    expect(v?.sampleSize).toBe(3);
    expect(v?.forecast).toMatchObject({ milestoneId: 'next', basis: 'cut', date: '2026-03-04', late: false });
  });

  it('counts from the cut when the next milestone is cut', () => {
    const rows = [
      shipped('a', 0, '2026-01-01', 10),
      shipped('b', 1, '2026-01-15', 20),
      milestone({ id: 'next', orderIndex: 2, status: 'active', cutAt: '2026-02-10T00:00:00Z' }),
    ];
    // median of [10, 20] = 15 days out from the 2026-02-10 cut
    expect(deriveShipVelocity(rows, NOW)?.forecast).toMatchObject({ basis: 'cut', date: '2026-02-25' });
  });

  it('counts from today, and says so, when the next milestone is not cut yet', () => {
    const rows = [
      shipped('a', 0, '2026-01-01', 10),
      shipped('b', 1, '2026-01-15', 20),
      milestone({ id: 'next', orderIndex: 2, status: 'planned', cutAt: null }),
    ];
    expect(deriveShipVelocity(rows, NOW)?.forecast).toMatchObject({ basis: 'today', date: '2026-03-16' });
  });

  it('flags a forecast that lands past the declared target', () => {
    const rows = [
      shipped('a', 0, '2026-01-01', 30),
      shipped('b', 1, '2026-01-15', 30),
      milestone({ id: 'next', orderIndex: 2, status: 'active', cutAt: '2026-02-10T00:00:00Z', targetDate: '2026-03-01' }),
    ];
    const f = deriveShipVelocity(rows, NOW)?.forecast;
    expect(f).toMatchObject({ date: '2026-03-12', targetDate: '2026-03-01', late: true });
  });

  it('is not late when the forecast lands on or before the target', () => {
    const rows = [
      shipped('a', 0, '2026-01-01', 10),
      shipped('b', 1, '2026-01-15', 10),
      milestone({ id: 'next', orderIndex: 2, status: 'active', cutAt: '2026-02-10T00:00:00Z', targetDate: '2026-02-20' }),
    ];
    expect(deriveShipVelocity(rows, NOW)?.forecast).toMatchObject({ date: '2026-02-20', late: false });
  });

  it('reports the cycle time with no forecast once everything is shipped', () => {
    const rows = [shipped('a', 0, '2026-01-01', 10), shipped('b', 1, '2026-01-15', 14)];
    const v = deriveShipVelocity(rows, NOW);
    expect(v?.medianDays).toBe(12);
    expect(v?.forecast).toBeNull();
  });
});
