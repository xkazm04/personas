import { describe, it, expect } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import { bucketSeries, measuredAtMs, sharedWindow, weeklyStateSeries } from '../kpiSample';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1); // 2026-09-01

function m(kpi_id: string, dayOffset: number, value: number, over: Partial<DevKpiMeasurement> = {}): DevKpiMeasurement {
  return {
    id: `${kpi_id}-${dayOffset}`, kpi_id, value,
    measured_at: new Date(T0 + dayOffset * DAY).toISOString().replace('T', ' ').slice(0, 19),
    source: 'scan', env: 'production', evidence: null, note: null, ...over,
  };
}

describe('bucketSeries', () => {
  it('keeps the last value per equal bucket and omits empty buckets (a gap, not a zero)', () => {
    const ms = [m('a', 0, 1), m('a', 1, 2), m('a', 15, 3), m('a', 16, 4)];
    const pts = bucketSeries(ms, 4, { from: T0, to: T0 + 16 * DAY });
    expect(pts.map((p) => p.v)).toEqual([2, 4]);
    expect(pts).toHaveLength(2);
  });
  it('returns the single point of a one-point series and nothing for none', () => {
    expect(bucketSeries([m('a', 3, 7)]).map((p) => p.v)).toEqual([7]);
    expect(bucketSeries([])).toEqual([]);
  });
  it('filters by env when asked', () => {
    const ms = [m('a', 0, 1), m('a', 1, 9, { env: 'local', source: 'simulation' })];
    expect(bucketSeries(ms, 8, undefined, 'production').map((p) => p.v)).toEqual([1]);
  });
});

describe('sharedWindow', () => {
  it('spans every listed series', () => {
    const w = sharedWindow({ a: [m('a', 2, 1)], b: [m('b', 9, 1)], c: [m('c', 0, 1)] }, ['a', 'b']);
    expect(w).toEqual({ from: measuredAtMs(m('a', 2, 1)), to: measuredAtMs(m('b', 9, 1)) });
    expect(sharedWindow({}, ['zzz'])).toBeNull();
  });
});

describe('weeklyStateSeries', () => {
  const kpi = {
    id: 'a', project_id: 'p', status: 'active', category: 'quality', direction: 'up',
    target_value: 10, baseline_value: null, crit_at: 5, created_at: '2026-01-01 00:00:00',
  } as unknown as DevKpi;
  it('judges each week by the latest reading at or before its end, gaps where none', () => {
    const now = T0 + 21 * DAY; // 2026-09-22 (a Tuesday)
    const rows = weeklyStateSeries([kpi], { a: [m('a', 8, 3), m('a', 15, 10)] }, 5, now);
    expect(rows).toHaveLength(5);
    expect(rows[rows.length - 1]!.partial).toBe(true);
    const measured = rows.map((r) => r.measured);
    // Weeks before the first reading carry measured 0 (a gap), then the
    // reading of day 8 (3 → off-track) holds until day 15 (10 → met).
    expect(measured[0]).toBe(0);
    expect(rows.some((r) => r.offTrack === 1)).toBe(true);
    expect(rows[rows.length - 1]!.met).toBe(1);
  });
  it('ignores simulated and non-production rows', () => {
    const rows = weeklyStateSeries([kpi], { a: [m('a', 1, 10, { env: 'test', source: 'simulation' })] }, 2, T0 + 14 * DAY);
    expect(rows.every((r) => r.measured === 0)).toBe(true);
  });
});
