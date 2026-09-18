import { describe, it, expect } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevProject } from '@/lib/bindings/DevProject';
import { buildOverview } from '../kpiOverviewModel';
import {
  COVERAGE_DAYS,
  GRID_ID_CAP,
  coverageArea,
  coverageLine,
  coveragePoints,
  coverageSeries,
  coverageWindow,
  gridKpiIds,
  stackShares,
} from '../variants/ProjectGrid.model';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);

function kpi(over: Partial<DevKpi>): DevKpi {
  return {
    id: 'k', project_id: 'p1', context_group_id: null, context_id: null, use_case_id: null,
    name: 'k', description: '', category: 'quality', tier: 'supporting', measure_kind: 'manual',
    cadence: 'manual', status: 'active', created_by: 'user', metric_type: null, needed_connector: null,
    measure_config: '{}', unit: '', direction: 'up', baseline_value: 0, target_value: 100,
    target_date: null, current_value: null, last_measured_at: null, warn_at: null, crit_at: null,
    manual_rating: null, assessment_pros: null, assessment_cons: null, last_skip_at: null,
    last_skip_rationale: null, rationale: null, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    ...over,
  } as DevKpi;
}
function m(kpi_id: string, day: number, over: Partial<DevKpiMeasurement> = {}): DevKpiMeasurement {
  return {
    id: `${kpi_id}-${day}`, kpi_id, value: 1,
    measured_at: new Date(T0 + day * DAY).toISOString().replace('T', ' ').slice(0, 19),
    source: 'scan', env: 'production', evidence: null, note: null, ...over,
  };
}
const projects = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }] as DevProject[];
const groups = [{ id: 'g1', project_id: 'p1', name: 'Core', color: '#000', domain: 'feature' }] as DevContextGroup[];

describe('gridKpiIds', () => {
  it('lists the measured ids per project and a flat capped list', () => {
    const ov = buildOverview(
      [
        kpi({ id: 'a', context_group_id: 'g1', current_value: 10 }),
        kpi({ id: 'b' }),
        kpi({ id: 'c', project_id: 'p2', current_value: 5 }),
      ],
      projects, groups, 'Ungrouped',
    );
    const { byProject, all } = gridKpiIds(ov);
    expect(all.sort()).toEqual(['a', 'c']);
    expect(byProject.p1).toEqual(['a']);
    expect(byProject.p2).toEqual(['c']);
  });
  it('honors the cap and still lists every project (later cards just have no ids)', () => {
    const many = Array.from({ length: 6 }, (_, i) => kpi({ id: `k${i}`, current_value: 1 }));
    const ov = buildOverview([...many, kpi({ id: 'z', project_id: 'p2', current_value: 1 })], projects, groups, 'Ungrouped');
    const { byProject, all } = gridKpiIds(ov, 3);
    expect(all).toHaveLength(3);
    expect(Object.keys(byProject).sort()).toEqual(['p1', 'p2']);
    expect(GRID_ID_CAP).toBe(400);
  });
});

describe('stackShares — share of TOTAL, so two cards are comparable', () => {
  const ov = buildOverview(
    [
      kpi({ id: 'a', current_value: 100 }),                      // met
      kpi({ id: 'b', current_value: 40, crit_at: 50 }),           // off-track
      kpi({ id: 'c', current_value: 40, target_value: null }),    // unpaced
      kpi({ id: 'd' }),                                           // unmeasured
    ],
    projects, groups, 'Ungrouped',
  )[0]!;

  it('splits every KPI into exactly one segment and sums to 100 %', () => {
    const segs = stackShares(ov);
    expect(segs.map((s) => s.key)).toEqual(['met', 'offTrack', 'unpaced', 'unmeasured']);
    expect(segs.reduce((n, s) => n + s.count, 0)).toBe(4);
    expect(segs.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(100);
  });
  it('omits empty segments and never divides by zero', () => {
    expect(stackShares({ ...ov, total: 0, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0 })).toEqual([]);
  });
});

describe('coverageSeries', () => {
  const window = { from: T0, to: T0 + 8 * DAY };
  const trends: Record<string, DevKpiMeasurement[]> = { a: [m('a', 0), m('a', 6)], b: [m('b', 4)] };

  it('counts a KPI from its FIRST real reading, against the project total', () => {
    const s = coverageSeries(['a', 'b'], trends, 4, window);
    expect(s).toEqual([0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5]);
  });
  it('ignores simulated and non-production readings', () => {
    const sim = { a: [m('a', 0, { source: 'simulation', env: 'local' }), m('a', 1, { env: 'test' })] };
    expect(coverageSeries(['a'], sim, 2, window)).toEqual([]);
  });
  it('draws nothing rather than a flat zero for an empty or unmeasured project', () => {
    expect(coverageSeries([], {}, 5, window)).toEqual([]);
    expect(coverageSeries(['a'], trends, 0, window)).toEqual([]);
  });
  it('shares one 30-day window across cards', () => {
    const w = coverageWindow(T0);
    expect(w.to).toBe(T0);
    expect((w.to - w.from) / DAY).toBe(COVERAGE_DAYS);
  });
});

describe('coveragePoints / area / line', () => {
  it('maps the FIXED 0–1 domain to the box, top at 1 and bottom at 0', () => {
    expect(coveragePoints([0])[0]!.y).toBe(27);
    expect(coveragePoints([1])[0]!.y).toBe(1);
    expect(coveragePoints([0, 1]).map((p) => p.x)).toEqual([0, 100]);
  });
  it('gives no line and no area for fewer than two points', () => {
    expect(coverageLine([0.5])).toBe('');
    expect(coverageArea([0.5])).toBe('');
    expect(coverageLine([0, 1])).toBe('0,27 100,1');
    expect(coverageArea([0, 1]).startsWith('M 0 28')).toBe(true);
  });
});
