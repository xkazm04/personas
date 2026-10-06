// The spine's sequence and its cursor. The whole concept rests on the
// sequence being the estate's OWN ranking and on the cursor never lying about
// where it is, so both are pinned here.
import { describe, expect, it } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';

import { buildEstate } from '../estate/kpiEstate';
import { UNGROUPED_KEY, type KpiProjectRollup } from '../kpiOverviewModel';
import { buildSpine, jumpSegment, segmentIndexAt, stepCursor, travelOf } from '../variants/console/Console.model';

const NOW = Date.parse('2026-10-06T12:00:00Z');

function kpi(over: Partial<DevKpi> = {}): DevKpi {
  return {
    id: 'k', project_id: 'p', context_group_id: 'g', name: 'KPI', description: null,
    category: 'quality', measure_kind: 'manual', measure_config: null, unit: '%',
    direction: 'up', baseline_value: 0, target_value: 100, target_date: null,
    current_value: null, last_measured_at: null, cadence: 'weekly', status: 'active',
    created_by: 'test', rationale: null, needed_connector: null,
    created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
    metric_type: null, tier: 'supporting', context_id: null, warn_at: null, crit_at: null,
    manual_rating: null, assessment_pros: null, assessment_cons: null,
    last_skip_at: null, last_skip_rationale: null, use_case_id: null,
    ...over,
  } as DevKpi;
}

function cell(groupId: string | null, label: string, kpis: DevKpi[]) {
  return {
    key: `x:${groupId ?? 'ungrouped'}`, projectId: 'x', groupId, label, domain: null, color: null,
    total: kpis.length, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0,
    coverage: 0, offTrackShare: null, band: 'unmeasured' as const, kpis,
  };
}

function rollup(projectId: string, label: string, groups: ReturnType<typeof cell>[]): KpiProjectRollup {
  const kpis = groups.flatMap((g) => g.kpis);
  return {
    projectId, label, groupsUnknown: false, total: kpis.length, measured: 0, met: 0,
    onTrack: 0, offTrack: 0, unpaced: 0, coverage: 0, offTrackShare: null, band: 'unmeasured',
    groups: groups.map((g) => ({ ...g, projectId, key: `${projectId}:${g.groupId ?? 'ungrouped'}` })),
  };
}

const estate = buildEstate([
  rollup('p1', 'personas', [
    cell('g1', 'first', [kpi({ id: 'a' }), kpi({ id: 'b' })]),
    cell(null, 'Ungrouped', [kpi({ id: 'c', context_group_id: null })]),
  ]),
  rollup('p2', 'ascent', [cell('g2', 'second', [kpi({ id: 'd' }), kpi({ id: 'e' })])]),
], NOW);

describe('buildSpine', () => {
  it('flattens the whole estate with nothing capped', () => {
    const spine = buildSpine(estate);
    expect(spine.ticks).toHaveLength(5);
    expect(spine.ticks.map((t) => t.kpi.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps the project and group each tick came from, so a descent resolves', () => {
    const tick = buildSpine(estate).ticks.find((t) => t.kpi.id === 'c')!;
    expect([tick.projectId, tick.groupId]).toEqual(['p1', UNGROUPED_KEY]);
    expect(tick.projectLabel).toBe('personas');
  });

  it('records one segment per project, in the estate\'s own order, with running starts', () => {
    const spine = buildSpine(estate);
    expect(spine.segments.map((s) => [s.label, s.start, s.count])).toEqual([
      ['personas', 0, 3], ['ascent', 3, 2],
    ]);
  });

  it('a never-read KPI carries a null age rather than a zero', () => {
    expect(buildSpine(estate).ticks[0]!.age).toBeNull();
  });

  it('an empty estate produces an empty spine, not a one-tick one', () => {
    const spine = buildSpine(buildEstate([], NOW));
    expect([spine.ticks.length, spine.segments.length]).toEqual([0, 0]);
  });
});

describe('the cursor', () => {
  const spine = buildSpine(estate);

  it('clamps instead of wrapping, because the sequence is a ranking', () => {
    expect(stepCursor(spine, 0, -1)).toBe(0);
    expect(stepCursor(spine, 4, 1)).toBe(4);
    expect(stepCursor(spine, 0, 2)).toBe(2);
    expect(stepCursor(spine, 2, -40)).toBe(0);
  });

  it('survives an empty spine without going negative', () => {
    expect(stepCursor(buildSpine(buildEstate([], NOW)), 0, 1)).toBe(0);
  });

  it('knows which project it is standing in', () => {
    expect(segmentIndexAt(spine, 0)).toBe(0);
    expect(segmentIndexAt(spine, 2)).toBe(0);
    expect(segmentIndexAt(spine, 3)).toBe(1);
  });

  it('jumps back to the top of the project you are in before leaving it', () => {
    expect(jumpSegment(spine, 2, -1)).toBe(0);
    expect(jumpSegment(spine, 0, -1)).toBe(0);
    expect(jumpSegment(spine, 4, -1)).toBe(3);
    expect(jumpSegment(spine, 3, -1)).toBe(0);
  });

  it('jumps forward to the next project, and stays put at the last one', () => {
    expect(jumpSegment(spine, 0, 1)).toBe(3);
    expect(jumpSegment(spine, 3, 1)).toBe(3);
  });
});

describe('travelOf', () => {
  it('reports the reading between the two numbers that frame it', () => {
    expect(travelOf(kpi({ baseline_value: 0, current_value: 40, target_value: 100 }))?.pct).toBe(40);
  });

  it('does NOT clamp, so an overshoot and a regression are each visible as themselves', () => {
    const over = travelOf(kpi({ baseline_value: 0, current_value: 130, target_value: 100 }))!;
    expect([over.pct, over.overshot, over.regressed]).toEqual([130, true, false]);
    const under = travelOf(kpi({ baseline_value: 20, current_value: 10, target_value: 100 }))!;
    expect([under.pct, under.overshot, under.regressed]).toEqual([-12.5, false, true]);
  });

  it('reads a down-is-better KPI on the same line, because baseline and target carry the direction', () => {
    expect(travelOf(kpi({ direction: 'down', baseline_value: 100, current_value: 40, target_value: 0 }))?.pct).toBe(60);
  });

  it('is null when the three numbers frame nothing', () => {
    expect(travelOf(kpi({ current_value: null }))).toBeNull();
    expect(travelOf(kpi({ current_value: 5, target_value: null }))).toBeNull();
    expect(travelOf(kpi({ current_value: 5, baseline_value: null }))).toBeNull();
    expect(travelOf(kpi({ current_value: 5, baseline_value: 50, target_value: 50 }))).toBeNull();
  });
});
