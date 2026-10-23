// Pace is a function of time. A past reading must be judged against the
// expected point on the baseline-to-target line AT ITS OWN TIME, not today's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevProject } from '@/lib/bindings/DevProject';

import { kpiTrack, kpiTrackAt } from '../kpiMath';
import { weeklyStateSeries } from '../kpiSample';
import { buildOverview } from '../kpiOverviewModel';
import { stateChanges } from '../variants/AttentionLedger.model';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1); // Tue 2026-09-01, the KPI's creation
const NOW = T0 + 84 * DAY;
const sql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// 0 -> 100 over 100 days, linear pace, 10-point tolerance. No critical line.
const kpi = {
  id: 'a', project_id: 'p1', context_group_id: null, name: 'Coverage', status: 'active',
  category: 'quality', direction: 'up', baseline_value: 0, target_value: 100,
  target_date: '2026-12-10', crit_at: null, current_value: 80, created_at: sql(T0),
} as DevKpi;

function m(day: number, value: number): DevKpiMeasurement {
  return {
    id: `a-${day}`, kpi_id: 'a', value, measured_at: sql(T0 + day * DAY),
    source: 'scan', env: 'production', evidence: null, note: null,
  } as DevKpiMeasurement;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('judging a reading at its own instant', () => {
  it('a value on pace on day 8 is off pace on day 84', () => {
    expect(kpiTrackAt(kpi, 10, T0 + 8 * DAY)).toBe('on-track');
    expect(kpiTrack({ ...kpi, current_value: 10 })).toBe('off-track');
  });

  it('the weekly river grades each past week as of that week', () => {
    const rows = weeklyStateSeries([kpi], { a: [m(8, 10)] }, 12, NOW, 'UTC');
    const first = rows.find((r) => r.measured === 1)!;
    // The week holding day 8 ends by day 13 (expected 13, floor 3): 10 is on pace.
    expect(first.onTrack).toBe(1);
    expect(first.offTrack).toBe(0);
    // The same value carried into the open week is off pace now.
    expect(rows[rows.length - 1]!.offTrack).toBe(1);
  });

  it('the ledger reports no state change when both readings were on pace when taken', () => {
    const ov = buildOverview([kpi], [{ id: 'p1', name: 'P' }] as DevProject[], [] as DevContextGroup[], 'Ungrouped');
    expect(stateChanges(ov[0]!, { a: [m(8, 10), m(82, 80)] })).toEqual([]);
  });
});
