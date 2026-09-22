// The map's geometry. Area is a claim, so a wrong rectangle is a wrong claim.
import { describe, expect, it } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { buildEstate } from '../estate/kpiEstate';
import type { KpiProjectRollup } from '../kpiOverviewModel';
import { fitsLabel, layoutMap, plotArea, plotColumns } from '../variants/map/mapLayout';
import { brokenPromises, plotStyle } from '../variants/map/mapPlot';

const NOW = Date.parse('2026-09-21T12:00:00Z');
const RECT = { x: 0, y: 0, w: 1000, h: 600 };

function kpi(id: string, over: Partial<DevKpi> = {}): DevKpi {
  return {
    id, project_id: 'p', context_group_id: 'g', name: id, description: null, category: 'quality',
    measure_kind: 'manual', measure_config: null, unit: '%', direction: 'up', baseline_value: 0,
    target_value: 100, target_date: null, current_value: null, last_measured_at: null,
    cadence: 'weekly', status: 'active', created_by: 't', rationale: null, needed_connector: null,
    created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00', metric_type: null,
    tier: 'supporting', context_id: null, warn_at: null, crit_at: null, manual_rating: null,
    assessment_pros: null, assessment_cons: null, last_skip_at: null, last_skip_rationale: null,
    use_case_id: null, ...over,
  } as DevKpi;
}

function project(id: string, groups: Array<{ id: string; n: number }>): KpiProjectRollup {
  return {
    projectId: id, label: id, groupsUnknown: false, total: 0, measured: 0, met: 0, onTrack: 0,
    offTrack: 0, unpaced: 0, coverage: 0, offTrackShare: null, band: 'unmeasured',
    groups: groups.map((g) => ({
      key: `${id}:${g.id}`, projectId: id, groupId: g.id, label: g.id, domain: null, color: null,
      total: g.n, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0, coverage: 0,
      offTrackShare: null, band: 'unmeasured' as const,
      kpis: Array.from({ length: g.n }, (_, i) => kpi(`${id}-${g.id}-${i}`)),
    })),
  };
}

describe('layoutMap', () => {
  const estate = buildEstate(
    [project('big', [{ id: 'a', n: 400 }, { id: 'b', n: 200 }]), project('small', [{ id: 'c', n: 6 }])],
    NOW,
  );

  const area = (frames: ReturnType<typeof layoutMap>['frames'], id: string) => {
    const f = frames.find((x) => x.projectId === id)!;
    return f.rect.w * f.rect.h;
  };

  it('gives a project area in proportion to what it CLAIMS, not to its health', () => {
    const even = buildEstate(
      [project('a', [{ id: 'x', n: 300 }]), project('b', [{ id: 'y', n: 100 }])],
      NOW,
    );
    const { frames, floored } = layoutMap(even, null, RECT);
    // Both are above the minimum share, so area is exactly the claim.
    expect(floored).toBe(0);
    expect(area(frames, 'a') / area(frames, 'b')).toBeCloseTo(3, 1);
  });

  it('draws a tiny project at the floor rather than dropping it, and SAYS it did', () => {
    const { frames, floored } = layoutMap(estate, null, RECT);
    // 6 KPIs against 600 would tile to a 10px sliver and disappear.
    expect(frames.map((f) => f.projectId).sort()).toEqual(['big', 'small']);
    expect(floored).toBe(1);
    expect(area(frames, 'small')).toBeGreaterThan(0);
  });

  it('tiles the whole box without spilling out of it', () => {
    const { frames } = layoutMap(estate, null, RECT);
    for (const f of frames) {
      expect(f.rect.x).toBeGreaterThanOrEqual(-0.01);
      expect(f.rect.y).toBeGreaterThanOrEqual(-0.01);
      expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(RECT.w + 0.01);
      expect(f.rect.y + f.rect.h).toBeLessThanOrEqual(RECT.h + 0.01);
    }
  });

  it('puts one frame and every group inside it when descended into a project', () => {
    const big = estate.projects.find((p) => p.projectId === 'big')!;
    const layout = layoutMap(estate, big, RECT);
    expect(layout.frames).toHaveLength(1);
    expect(layout.territories.map((t) => t.label).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing rather than a degenerate tiling for a zero-width box', () => {
    const layout = layoutMap(estate, null, { x: 0, y: 0, w: 0, h: 0 });
    expect(layout.frames).toHaveLength(0);
    expect(layout.territories).toHaveLength(0);
  });

  it('carries a failed group read onto the frame as a label', () => {
    const failed = buildEstate([{ ...project('p', [{ id: 'g', n: 3 }]), groupsUnknown: true }], NOW);
    expect(layoutMap(failed, null, RECT).frames[0]!.groupsUnknown).toBe(true);
  });
});

describe('plot geometry', () => {
  it('only claims room for a name when a name would fit', () => {
    expect(fitsLabel({ x: 0, y: 0, w: 120, h: 60 })).toBe(true);
    expect(fitsLabel({ x: 0, y: 0, w: 40, h: 20 })).toBe(false);
    // a territory too small for a label gives all of itself to plots; one
    // with room spends a strip on the name
    const tiny = { x: 0, y: 0, w: 40, h: 60 };
    const labelled = { x: 0, y: 0, w: 120, h: 60 };
    expect(plotArea(tiny).h).toBeGreaterThan(plotArea(labelled).h);
  });

  it('chooses columns that keep plots near square, and never returns zero', () => {
    expect(plotColumns(100, 100, 100)).toBe(10);
    expect(plotColumns(1, 100, 10)).toBe(1);
    expect(plotColumns(0, 0, 0)).toBe(1);
  });
});

describe('plotStyle — light is observation', () => {
  it('leaves a never-read KPI dark under either lens', () => {
    expect(plotStyle(kpi('a'), NOW, 'state').fill).toBeNull();
    expect(plotStyle(kpi('a'), NOW, 'freshness').fill).toBeNull();
  });

  it('marks a broken promise only where a rhythm was actually promised', () => {
    expect(plotStyle(kpi('a', { cadence: 'weekly' }), NOW, 'state').brokenPromise).toBe(true);
    expect(plotStyle(kpi('a', { cadence: 'manual' }), NOW, 'state').brokenPromise).toBe(false);
    // ...and never on a KPI that HAS been read
    expect(plotStyle(kpi('a', { cadence: 'weekly', current_value: 5 }), NOW, 'state').brokenPromise).toBe(false);
  });

  it('counts broken promises as a quantity for the legend', () => {
    expect(brokenPromises([kpi('a'), kpi('b', { cadence: 'manual' }), kpi('c', { current_value: 1 })])).toBe(1);
  });
});
