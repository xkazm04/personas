import { describe, it, expect } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevProject } from '@/lib/bindings/DevProject';
import { bandOf, buildOverview, findGroup, rankNextMove, UNGROUPED_KEY } from '../kpiOverviewModel';

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
const projects = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }] as DevProject[];
const groups = [{ id: 'g1', project_id: 'p1', name: 'Core', color: '#000', domain: 'feature' }] as DevContextGroup[];

describe('bandOf — the share ladder over MEASURED KPIs', () => {
  it('is unmeasured with nothing measured, and with measured-but-unpaced only', () => {
    expect(bandOf({ measured: 0, met: 0, onTrack: 0, offTrack: 0 })).toBe('unmeasured');
    expect(bandOf({ measured: 3, met: 0, onTrack: 0, offTrack: 0 })).toBe('unmeasured');
  });
  it('steps strained ≥ 50 %, mixed ≥ 25 %, met when all met, else healthy', () => {
    expect(bandOf({ measured: 4, met: 0, onTrack: 2, offTrack: 2 })).toBe('strained');
    expect(bandOf({ measured: 4, met: 0, onTrack: 3, offTrack: 1 })).toBe('mixed');
    expect(bandOf({ measured: 5, met: 1, onTrack: 4, offTrack: 0 })).toBe('healthy');
    expect(bandOf({ measured: 2, met: 2, onTrack: 0, offTrack: 0 })).toBe('met');
  });
});

describe('buildOverview', () => {
  const kpis = [
    kpi({ id: 'a', context_group_id: 'g1', current_value: 100 }),           // met
    kpi({ id: 'b', context_group_id: 'g1' }),                               // unmeasured
    kpi({ id: 'c', current_value: 0, category: 'value' }),                  // ungrouped, floor → off-track
    kpi({ id: 'd', project_id: 'p2', current_value: 100 }),
    kpi({ id: 'e', status: 'archived', current_value: 100 }),
  ];
  const ov = buildOverview(kpis, projects, groups, 'Ungrouped');

  it('skips non-active KPIs and keeps ungrouped ones in a named cell', () => {
    const alpha = ov.find((p) => p.projectId === 'p1')!;
    expect(alpha.total).toBe(3);
    const ung = alpha.groups.find((g) => g.groupId === null)!;
    expect(ung.label).toBe('Ungrouped');
    expect(ung.key).toBe(`p1:${UNGROUPED_KEY}`);
    expect(ung.band).toBe('strained');
  });
  it('coverage counts measured over total, band ignores the unmeasured', () => {
    const core = findGroup(ov, { projectId: 'p1', groupId: 'g1' })!;
    expect(core.coverage).toBe(0.5);
    expect(core.band).toBe('met');
  });
  it('sorts worst band first across projects and groups', () => {
    expect(ov.map((p) => p.label)).toEqual(['Alpha', 'Beta']);
    const alpha = ov[0]!;
    expect(alpha.groups.map((g) => g.band)).toEqual(['strained', 'met']);
  });
  it('marks a lane whose group read failed instead of hiding it', () => {
    const failed = buildOverview(kpis, projects, [], 'Ungrouped', new Set(['p1']));
    expect(failed.find((p) => p.projectId === 'p1')!.groupsUnknown).toBe(true);
    expect(findGroup(failed, { projectId: 'p1', groupId: UNGROUPED_KEY })!.total).toBe(3);
  });
});

describe('rankNextMove', () => {
  it('returns null with nothing off-track, else the largest shortfall × urgency', () => {
    const calm = buildOverview([kpi({ id: 'a', current_value: 100 })], projects, groups, 'U');
    expect(rankNextMove(calm[0]!)).toBeNull();
    const busy = buildOverview(
      [
        kpi({ id: 'near', current_value: 90, crit_at: 95 }),
        kpi({ id: 'far', current_value: 10, crit_at: 95 }),
      ],
      projects, groups, 'U',
    );
    expect(rankNextMove(busy[0]!)?.id).toBe('far');
  });
});
