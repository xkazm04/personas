// The bench's arithmetic. Two gates and a yield, and the yield is the number
// the whole surface is built to print, so a wrong one is a lie about mechanism.
import { describe, expect, it } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';

import { buildEstate } from '../estate/kpiEstate';
import type { KpiProjectRollup } from '../kpiOverviewModel';
import { buildAssay } from '../variants/assay/Assay.model';
import { groupPlaces, projectPlaces, UNGROUPED_PLACE } from '../variants/kpiPlaces';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-06T12:00:00Z');

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

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

/** One cell of a project rollup. */
function cell(groupId: string | null, label: string, kpis: DevKpi[]) {
  return {
    key: `p:${groupId ?? 'ungrouped'}`, projectId: 'p', groupId, label, domain: null, color: null,
    total: kpis.length, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0,
    coverage: 0, offTrackShare: null, band: 'unmeasured' as const, kpis,
  };
}

/** One project, one group, whatever KPIs the case needs. */
function estateOf(kpis: DevKpi[], label = 'alpha', projectId = 'p') {
  const rollup: KpiProjectRollup = {
    projectId, label, groupsUnknown: false, total: kpis.length, measured: 0, met: 0,
    onTrack: 0, offTrack: 0, unpaced: 0, coverage: 0, offTrackShare: null, band: 'unmeasured',
    groups: [{
      key: `${projectId}:g`, projectId, groupId: 'g', label: 'group', domain: null, color: null,
      total: kpis.length, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0,
      coverage: 0, offTrackShare: null, band: 'unmeasured', kpis,
    }],
  };
  return buildEstate([rollup], NOW);
}

/** The bench at portfolio altitude, which is what most cases read. */
function bench(estate: ReturnType<typeof buildEstate>) {
  return buildAssay(projectPlaces(estate), NOW);
}

describe('buildAssay — lanes', () => {
  it('splits the estate by measure_kind and orders lanes by declared size', () => {
    const assay = bench(estateOf([
      kpi({ id: 'a', measure_kind: 'manual' }),
      kpi({ id: 'b', measure_kind: 'manual' }),
      kpi({ id: 'c', measure_kind: 'manual' }),
      kpi({ id: 'd', measure_kind: 'codebase' }),
      kpi({ id: 'e', measure_kind: 'connector' }),
    ]));
    expect(assay.lanes.map((l) => [l.kind, l.declared])).toEqual([
      ['manual', 3], ['codebase', 1], ['connector', 1],
    ]);
    expect(assay.declared).toBe(5);
    expect(assay.widest).toBe(3);
  });

  it('treats a blank measure_kind as manual rather than opening a nameless lane', () => {
    const assay = bench(estateOf([kpi({ measure_kind: '' })]));
    expect(assay.lanes.map((l) => l.kind)).toEqual(['manual']);
  });

  it('keeps a one-KPI lane: a mechanism nobody uses is itself a reading', () => {
    const assay = bench(estateOf([
      kpi({ id: 'a', measure_kind: 'manual' }),
      kpi({ id: 'z', measure_kind: 'derived', current_value: 50 }),
    ]));
    expect(assay.lanes.find((l) => l.kind === 'derived')?.declared).toBe(1);
  });
});

describe('buildAssay — the two gates', () => {
  it('loses the never-read at the first gate and the unjudgeable at the second', () => {
    const [lane] = bench(estateOf([
      kpi({ id: 'dark' }),
      kpi({ id: 'notarget', current_value: 40, target_value: null }),
      kpi({ id: 'nobase', current_value: 40, baseline_value: null }),
      kpi({ id: 'judged', current_value: 120 }),
    ])).lanes;
    expect(lane).toBeDefined();
    expect(lane!.declared).toBe(4);
    expect(lane!.observed).toBe(3);
    expect(lane!.verdict).toBe(1);
    expect(lane!.dark).toBe(1);
    expect(lane!.unjudged).toBe(2);
    expect(lane!.met).toBe(1);
  });

  it('yield is observed over declared, never verdict over declared', () => {
    const [lane] = bench(estateOf([
      kpi({ id: 'a', current_value: 10, target_value: null }),
      kpi({ id: 'b' }),
      kpi({ id: 'c' }),
      kpi({ id: 'd' }),
    ])).lanes;
    // one of four produced a number; none of them can be judged
    expect(lane!.yield).toBeCloseTo(0.25);
    expect(lane!.verdict).toBe(0);
  });

  it('names what the lost population is missing, commonest ordering preserved', () => {
    const [lane] = bench(estateOf([
      kpi({ id: 'a' }),
      kpi({ id: 'b' }),
      kpi({ id: 'c', current_value: 1, target_value: null }),
      kpi({ id: 'd', current_value: 1, baseline_value: null }),
    ])).lanes;
    expect(lane!.gaps).toEqual([
      { gap: 'reading', count: 2 },
      { gap: 'target', count: 1 },
      { gap: 'baseline', count: 1 },
    ]);
  });

  it('counts stale among the OBSERVED, so an unjudgeable reading can still be stale', () => {
    const [lane] = bench(estateOf([
      kpi({ id: 'old', current_value: 10, last_measured_at: iso(NOW - 40 * DAY) }),
      kpi({ id: 'dark' }),
    ])).lanes;
    expect(lane!.stale).toBe(1);
    expect(lane!.dark).toBe(1);
  });

  it('an estate with no KPIs produces no lanes and no NaN yield', () => {
    const assay = bench(buildEstate([], NOW));
    expect(assay.lanes).toEqual([]);
    expect(assay.declared).toBe(0);
    expect(assay.widest).toBe(0);
  });
});

describe('buildAssay — who owns the loss', () => {
  it('attributes the stalled population to projects, largest first', () => {
    const big = estateOf([kpi({ id: 'a' }), kpi({ id: 'b' }), kpi({ id: 'c' })], 'big', 'p1');
    const small = estateOf([kpi({ id: 'd' })], 'small', 'p2');
    const assay = bench({
      ...big,
      projects: [...big.projects, ...small.projects],
      kpis: [...big.kpis, ...small.kpis],
    });
    const [lane] = assay.lanes;
    expect(lane!.stalled.map((s) => [s.label, s.count, s.dark])).toEqual([
      ['big', 3, 3], ['small', 1, 1],
    ]);
  });

  it('separates a project stalled for want of a reading from one stalled for want of a target', () => {
    const assay = bench(estateOf([
      kpi({ id: 'a' }),
      kpi({ id: 'b', current_value: 7, target_value: null }),
    ]));
    expect(assay.lanes[0]!.stalled[0]).toEqual({ id: 'p', label: 'alpha', count: 2, dark: 1 });
  });

  it('reads the same shape one altitude down, with groups as the places', () => {
    const estate = buildEstate([{
      projectId: 'p', label: 'alpha', groupsUnknown: false, total: 2, measured: 0, met: 0,
      onTrack: 0, offTrack: 0, unpaced: 0, coverage: 0, offTrackShare: null, band: 'unmeasured',
      groups: [
        cell('g1', 'first', [kpi({ id: 'a' })]),
        cell(null, 'Ungrouped', [kpi({ id: 'b', context_group_id: null })]),
      ],
    }], NOW);
    const places = groupPlaces(estate.projects[0]!);
    expect(places.map((p) => p.id).sort()).toEqual(['g1', UNGROUPED_PLACE]);
    const lane = buildAssay(places, NOW).lanes[0]!;
    expect(lane.declared).toBe(2);
    expect(lane.stalled.map((s) => s.count)).toEqual([1, 1]);
  });
});
