import { describe, it, expect } from 'vitest';
import { kpiPct, adaptPendingAcceptance, type PendingKpi } from '../goalAcceptanceModel';
import type { PendingAcceptanceGoal } from '@/lib/bindings/PendingAcceptanceGoal';

function makeKpi(overrides: Partial<PendingKpi>): PendingKpi {
  return {
    id: 'k1',
    name: 'Some KPI',
    unit: '',
    direction: 'up',
    baseline: 0,
    current: 50,
    target: 100,
    offTrack: false,
    ...overrides,
  };
}

function makeRow(overrides: Partial<PendingAcceptanceGoal>): PendingAcceptanceGoal {
  return {
    goal_id: 'g1',
    title: 'Some goal',
    summary: null,
    project_id: 'proj1',
    project_name: 'Project One',
    team_id: 'team1',
    team_name: 'Team One',
    kpi_id: 'k1',
    kpi_name: 'Some KPI',
    kpi_unit: '',
    kpi_current: 50,
    kpi_target: 100,
    kpi_baseline: null,
    kpi_direction: 'up',
    completed_at: null,
    ...overrides,
  } as PendingAcceptanceGoal;
}

describe('kpiPct — no fabricated 0% progress when baseline was never recorded', () => {
  it('regression: baseline null returns null, not a forced 0%', () => {
    expect(kpiPct(makeKpi({ baseline: null, current: 50, target: 100 }))).toBeNull();
  });

  it('computes real progress when a baseline exists', () => {
    // Matches kpiMath.ts's kpiProgressPct: (60-50)/(100-50) = 20%
    expect(kpiPct(makeKpi({ baseline: 50, current: 60, target: 100 }))).toBe(20);
  });
});

describe('adaptPendingAcceptance — baseline stays null instead of defaulting to current', () => {
  it('regression: a row with no kpi_baseline produces a KPI with baseline null (not === current)', () => {
    const { kpis } = adaptPendingAcceptance([makeRow({ kpi_baseline: null, kpi_current: 50 })]);
    expect(kpis).toHaveLength(1);
    expect(kpis[0]!.baseline).toBeNull();
    expect(kpiPct(kpis[0]!)).toBeNull();
  });

  it('a row WITH a recorded baseline keeps it (no regression on the happy path)', () => {
    const { kpis } = adaptPendingAcceptance([makeRow({ kpi_baseline: 10, kpi_current: 50, kpi_target: 100 })]);
    expect(kpis[0]!.baseline).toBe(10);
    expect(kpiPct(kpis[0]!)).toBe(Math.round(((50 - 10) / (100 - 10)) * 100));
  });
});
