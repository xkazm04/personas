import { describe, it, expect } from 'vitest';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { paceDescriptor, type PaceDescriptor } from '../kpiMath';
import { distancePct, type DistanceRow } from '../kpiDistance';
import { TRACK_COLOR } from '../kpiMeta';
import { buildProjectGroups } from '../KPIDashboard';

function makeKpi(overrides: Partial<DevKpi>): DevKpi {
  return {
    id: 'k1',
    project_id: 'proj1',
    context_group_id: null,
    context_id: null,
    use_case_id: null,
    name: 'Some KPI',
    description: null,
    category: 'technical',
    measure_kind: 'manual',
    measure_config: '{}',
    unit: '',
    direction: 'up',
    baseline_value: null,
    target_value: 100,
    target_date: null,
    current_value: 50,
    last_measured_at: null,
    cadence: 'manual',
    status: 'active',
    created_by: 'user',
    rationale: null,
    needed_connector: null,
    metric_type: null,
    tier: 'primary',
    warn_at: null,
    crit_at: null,
    manual_rating: null,
    assessment_pros: null,
    assessment_cons: null,
    last_skip_at: null,
    last_skip_rationale: null,
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-07-01 00:00:00',
    ...overrides,
  };
}

const projectName = (id: string) => (id === 'proj1' ? 'Project One' : id);

function buildRow(kpi: DevKpi, d: PaceDescriptor): DistanceRow {
  return {
    id: kpi.id,
    name: kpi.name,
    projectId: kpi.project_id,
    project: projectName(kpi.project_id),
    pct: distancePct(kpi) ?? 0,
    fill: TRACK_COLOR[d.track],
    current: kpi.current_value,
    target: kpi.target_value,
    unit: kpi.unit,
    track: d.track,
    reason: null,
    category: kpi.category,
    tier: kpi.tier,
  };
}

describe('buildProjectGroups — unmeasured KPIs are omitted, not shown at 0%', () => {
  it('regression: a KPI with no current_value (unmeasured) produces no row', () => {
    const unmeasured = makeKpi({ id: 'k-unmeasured', current_value: null });
    const paced = [{ kpi: unmeasured, d: paceDescriptor(unmeasured) }];
    expect(paced[0]!.d.track).toBe('unmeasured');

    const groups = buildProjectGroups(paced, projectName, buildRow);
    expect(groups).toHaveLength(0);
  });

  it('a measured KPI in the same project still renders its row', () => {
    const unmeasured = makeKpi({ id: 'k-unmeasured', current_value: null });
    const measured = makeKpi({ id: 'k-measured', current_value: 50, target_value: 100 });
    const paced = [
      { kpi: unmeasured, d: paceDescriptor(unmeasured) },
      { kpi: measured, d: paceDescriptor(measured) },
    ];

    const groups = buildProjectGroups(paced, projectName, buildRow);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['k-measured']);
  });
});

describe('buildProjectGroups — rows order by tier, then name', () => {
  // The dashboard used to ignore dev_kpis.tier entirely, rendering every KPI as
  // a peer even though kpi_derivation.rs:157 ranks them. Recharts draws bars in
  // data order, so this order IS the visual hierarchy.
  it('puts north_star above primary above supporting', () => {
    const kpis = [
      makeKpi({ id: 'k-sup', name: 'AAA supporting', tier: 'supporting' }),
      makeKpi({ id: 'k-pri', name: 'MMM primary', tier: 'primary' }),
      makeKpi({ id: 'k-north', name: 'ZZZ north star', tier: 'north_star' }),
    ];
    const paced = kpis.map((kpi) => ({ kpi, d: paceDescriptor(kpi) }));

    const groups = buildProjectGroups(paced, projectName, buildRow);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['k-north', 'k-pri', 'k-sup']);
  });

  it('falls back to name order within one tier', () => {
    const kpis = [
      makeKpi({ id: 'k-b', name: 'Bravo', tier: 'primary' }),
      makeKpi({ id: 'k-a', name: 'Alpha', tier: 'primary' }),
    ];
    const paced = kpis.map((kpi) => ({ kpi, d: paceDescriptor(kpi) }));

    const groups = buildProjectGroups(paced, projectName, buildRow);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['k-a', 'k-b']);
  });

  it('treats an unknown/absent tier as supporting rather than dropping the row', () => {
    const kpis = [
      makeKpi({ id: 'k-junk', name: 'Alpha', tier: 'not-a-tier' }),
      makeKpi({ id: 'k-pri', name: 'Zulu', tier: 'primary' }),
    ];
    const paced = kpis.map((kpi) => ({ kpi, d: paceDescriptor(kpi) }));

    const groups = buildProjectGroups(paced, projectName, buildRow);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['k-pri', 'k-junk']);
  });
});
