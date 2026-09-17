import { describe, it, expect } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import { buildOverview, UNGROUPED_KEY } from '../kpiOverviewModel';
import {
  buildPanelSeries,
  bulletScale,
  measuredIds,
  resolveSubject,
  sortBulletRows,
  sparkCoords,
} from '../layer/KpiGroupLayer.model';

function kpi(over: Partial<DevKpi>): DevKpi {
  return {
    id: 'k', project_id: 'p1', context_group_id: null, context_id: null, use_case_id: null,
    name: 'k', description: '', category: 'quality', tier: 'supporting', measure_kind: 'manual',
    cadence: 'manual', status: 'active', created_by: 'user', metric_type: null, needed_connector: null,
    measure_config: '{}', unit: '', direction: 'up', baseline_value: null, target_value: 100,
    target_date: null, current_value: null, last_measured_at: null, warn_at: null, crit_at: null,
    manual_rating: null, assessment_pros: null, assessment_cons: null, last_skip_at: null,
    last_skip_rationale: null, rationale: null, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    ...over,
  } as DevKpi;
}
function m(over: Partial<DevKpiMeasurement>): DevKpiMeasurement {
  return {
    id: 'm', kpi_id: 'a', value: 50, measured_at: '2026-01-01 00:00:00', source: 'manual',
    env: 'production', note: null, created_at: '2026-01-01 00:00:00',
    ...over,
  } as DevKpiMeasurement;
}

const projects = [{ id: 'p1', name: 'Alpha' }] as DevProject[];
const groups = [{ id: 'g1', project_id: 'p1', name: 'Core' }] as DevContextGroup[];

describe('resolveSubject', () => {
  const ov = buildOverview(
    [kpi({ id: 'a', context_group_id: 'g1', current_value: 100 }), kpi({ id: 'b' })],
    projects,
    groups,
    'Ungrouped',
  );

  it('groupId null = the whole project, with every group\'s KPIs', () => {
    const s = resolveSubject(ov, { projectId: 'p1', groupId: null })!;
    expect(s.groupLabel).toBeNull();
    expect(s.kpis.map((k) => k.id).sort()).toEqual(['a', 'b']);
    expect([s.measured, s.total]).toEqual([1, 2]);
  });

  it('resolves a named group and the ungrouped cell', () => {
    expect(resolveSubject(ov, { projectId: 'p1', groupId: 'g1' })!.groupLabel).toBe('Core');
    expect(resolveSubject(ov, { projectId: 'p1', groupId: UNGROUPED_KEY })!.groupLabel).toBe('Ungrouped');
  });

  it('is null when the project or the group is gone', () => {
    expect(resolveSubject(ov, { projectId: 'nope', groupId: null })).toBeNull();
    expect(resolveSubject(ov, { projectId: 'p1', groupId: 'gone' })).toBeNull();
  });
});

describe('sortBulletRows — off-track → on-track → met → unpaced → unmeasured', () => {
  it('orders by track then name', () => {
    const rows = sortBulletRows([
      kpi({ id: 'u', name: 'u' }),                                     // unmeasured
      kpi({ id: 'm2', name: 'b', current_value: 100 }),                // met
      kpi({ id: 'm1', name: 'a', current_value: 100 }),                // met
      kpi({ id: 'np', name: 'np', current_value: 5, target_value: null }), // unpaced
      kpi({ id: 'off', name: 'off', category: 'value', current_value: 0 }), // floor → off
      kpi({ id: 'on', name: 'on', current_value: 50, crit_at: 1 }),    // on-track
    ]);
    expect(rows.map((r) => r.kpi.id)).toEqual(['off', 'on', 'm1', 'm2', 'np', 'u']);
  });
  it('measuredIds drops the unmeasured ones', () => {
    expect(measuredIds(sortBulletRows([kpi({ id: 'x' }), kpi({ id: 'y', current_value: 1 })]))).toEqual(['y']);
  });
});

describe('bulletScale — zero-based magnitude, 10 % headroom', () => {
  it('scales every mark against max * 1.1', () => {
    const s = bulletScale(kpi({ current_value: 50, target_value: 100, baseline_value: 10 }))!;
    expect(s.current).toBeCloseTo((50 / 110) * 100, 5);
    expect(s.target).toBeCloseTo((100 / 110) * 100, 5);
    expect(s.baseline).toBeCloseTo((10 / 110) * 100, 5);
  });
  it('keeps the bar zero-based for a down-direction KPI (color carries the verdict)', () => {
    const s = bulletScale(kpi({ direction: 'down', current_value: 80, target_value: 20 }))!;
    expect(s.current!).toBeGreaterThan(s.target!);
  });
  it('is null with no values, and with no positive extent', () => {
    expect(bulletScale(kpi({ target_value: null }))).toBeNull();
    expect(bulletScale(kpi({ current_value: 0, target_value: 0 }))).toBeNull();
  });
  it('leaves current null when the KPI was never measured', () => {
    expect(bulletScale(kpi({ target_value: 100 }))!.current).toBeNull();
  });
});

describe('buildPanelSeries', () => {
  const rows = sortBulletRows([
    kpi({ id: 'a', name: 'a', current_value: 50, baseline_value: 0, target_value: 100 }),
    kpi({ id: 'b', name: 'b', current_value: 50, baseline_value: 0, target_value: 100 }),
  ]);
  const win = { from: 0, to: 1000 };

  it('normalizes onto % of target and marks simulated sources dashed-worthy', () => {
    const trends = {
      a: [m({ kpi_id: 'a', value: 50, measured_at: '2026-01-01 00:00:00' })],
      b: [m({ kpi_id: 'b', value: 50, source: 'simulation', measured_at: '2026-01-01 00:00:00' })],
    };
    const w = { from: new Date('2026-01-01T00:00:00').getTime() - 10, to: new Date('2026-01-01T00:00:00').getTime() + 10 };
    const out = buildPanelSeries(rows, trends, w, 'production');
    expect(out.map((s) => s.kpi.id)).toEqual(['a', 'b']);
    expect(out[0]!.points[0]!.v).toBe(50);
    expect(out[0]!.simulated).toBe(false);
    expect(out[1]!.simulated).toBe(true);
  });

  it('drops series with no point in the env, and returns nothing without a window', () => {
    const trends = { a: [m({ kpi_id: 'a', env: 'test' })] };
    expect(buildPanelSeries(rows, trends, win, 'production')).toEqual([]);
    expect(buildPanelSeries(rows, trends, null, 'test')).toEqual([]);
  });
});

describe('sparkCoords', () => {
  it('maps the shared window to x and the [-15,115] band to y', () => {
    const pts = sparkCoords([{ t: 0, v: -15 }, { t: 100, v: 115 }], { from: 0, to: 100 }, 96, 24);
    expect(pts[0]).toEqual({ x: 0, y: 22 });
    expect(pts[1]).toEqual({ x: 96, y: 2 });
  });
});
