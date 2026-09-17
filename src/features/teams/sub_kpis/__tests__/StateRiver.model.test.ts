import { describe, it, expect } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { KpiProjectRollup, KpiGroupRollup } from '../kpiOverviewModel';
import type { WeeklyState } from '../kpiSample';
import {
  RIVER_ID_CAP,
  hasReadings,
  partialWeekStart,
  planRiverIds,
  riverPoints,
  sharedRiverMax,
  stackedMax,
} from '../variants/StateRiver.model';

const WEEK = 7 * 86_400_000;

function w(i: number, over: Partial<WeeklyState> = {}): WeeklyState {
  return { week: i * WEEK, met: 0, onTrack: 0, offTrack: 0, measured: 0, partial: false, ...over };
}

function kpi(id: string, project_id: string, current_value: number | null): DevKpi {
  return { id, project_id, current_value, name: id, status: 'active' } as unknown as DevKpi;
}

function project(projectId: string, kpis: DevKpi[]): KpiProjectRollup {
  const group = { kpis } as unknown as KpiGroupRollup;
  return { projectId, label: projectId, groups: [group] } as unknown as KpiProjectRollup;
}

describe('riverPoints', () => {
  it('turns a week with nothing measured into a GAP (nulls), not a zero column', () => {
    const pts = riverPoints([w(0, { measured: 0 }), w(1, { measured: 3, met: 1, onTrack: 2 })]);
    expect(pts[0]).toMatchObject({ met: null, onTrack: null, offTrack: null, measured: 0 });
    expect(pts[1]).toMatchObject({ met: 1, onTrack: 2, offTrack: 0, measured: 3 });
  });

  it('keeps a real zero when something WAS measured — 0 off-track is a finding', () => {
    const pts = riverPoints([w(0, { measured: 5, met: 5 })]);
    expect(pts[0]!.offTrack).toBe(0);
  });

  it('carries the week stamp and the partial flag through untouched', () => {
    const pts = riverPoints([w(0), w(1, { measured: 1, met: 1, partial: true })]);
    expect(pts.map((p) => p.week)).toEqual([0, WEEK]);
    expect(partialWeekStart(pts)).toBe(WEEK);
    expect(partialWeekStart(riverPoints([w(0)]))).toBeNull();
  });
});

describe('stackedMax / sharedRiverMax', () => {
  it('sums the three stacked bands, skipping gap weeks', () => {
    const pts = riverPoints([w(0), w(1, { measured: 6, met: 2, onTrack: 3, offTrack: 1 }), w(2, { measured: 2, met: 2 })]);
    expect(stackedMax(pts)).toBe(6);
  });

  it('is 0 for an all-gap series but the shared max never drops below 1', () => {
    expect(stackedMax(riverPoints([w(0), w(1)]))).toBe(0);
    expect(sharedRiverMax([riverPoints([w(0)])])).toBe(1);
    expect(sharedRiverMax([])).toBe(1);
  });

  it('gives every project the SAME top: the tallest column anywhere', () => {
    const small = riverPoints([w(0, { measured: 3, met: 3 })]);
    const big = riverPoints([w(0, { measured: 300, met: 100, onTrack: 100, offTrack: 100 })]);
    const shared = sharedRiverMax([small, big]);
    expect(shared).toBe(300);
    expect(sharedRiverMax([big, small])).toBe(shared);
  });
});

describe('hasReadings', () => {
  it('is false when every week is a gap, true as soon as one week measured', () => {
    expect(hasReadings(riverPoints([w(0), w(1)]))).toBe(false);
    expect(hasReadings(riverPoints([w(0), w(1, { measured: 1 })]))).toBe(true);
  });
});

describe('planRiverIds', () => {
  it('asks only for KPIs that already have a reading', () => {
    const plan = planRiverIds([project('p1', [kpi('a', 'p1', 5), kpi('b', 'p1', null)])]);
    expect(plan.ids).toEqual(['a']);
    expect(plan.byProject.p1).toEqual(['a']);
    expect(plan.notLoaded).toEqual([]);
  });

  it('takes a project WHOLE or not at all, and names the ones the cap dropped', () => {
    const a = project('p1', Array.from({ length: 3 }, (_, i) => kpi(`a${i}`, 'p1', 1)));
    const b = project('p2', Array.from({ length: 3 }, (_, i) => kpi(`b${i}`, 'p2', 1)));
    const plan = planRiverIds([a, b], 4);
    expect(plan.ids).toEqual(['a0', 'a1', 'a2']);
    expect(plan.notLoaded).toEqual(['p2']);
    expect(plan.byProject.p2).toBeUndefined();
  });

  it('records a project with no measurable KPI as empty, not as dropped', () => {
    const plan = planRiverIds([project('p1', [kpi('a', 'p1', null)])]);
    expect(plan.byProject.p1).toEqual([]);
    expect(plan.notLoaded).toEqual([]);
    expect(plan.ids).toEqual([]);
  });

  it('defaults to the declared 400-id budget', () => {
    expect(RIVER_ID_CAP).toBe(400);
    const many = project('p1', Array.from({ length: 401 }, (_, i) => kpi(`k${i}`, 'p1', 1)));
    expect(planRiverIds([many]).notLoaded).toEqual(['p1']);
  });
});
