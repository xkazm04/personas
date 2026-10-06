// The almanac's clock. Every bar on the surface is a position on this axis,
// so a wrong sign here draws a late KPI as a scheduled one.
import { describe, expect, it } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';

import { buildAlmanac, dueOf, promisedShare } from '../variants/almanac/Almanac.model';
import { tallyKpis } from '../estate/kpiEstate';

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
    created_at: iso(NOW - 100 * DAY), updated_at: iso(NOW - 100 * DAY),
    metric_type: null, tier: 'supporting', context_id: null, warn_at: null, crit_at: null,
    manual_rating: null, assessment_pros: null, assessment_cons: null,
    last_skip_at: null, last_skip_rationale: null, use_case_id: null,
    ...over,
  } as DevKpi;
}

describe('dueOf', () => {
  it('a manual cadence promises no rhythm, so it is due NEVER rather than overdue', () => {
    const d = dueOf(kpi({ cadence: 'manual', current_value: 5, last_measured_at: iso(NOW - 900 * DAY) }), NOW);
    expect(d.state).toBe('never');
    expect(d.dueAt).toBeNull();
    expect(d.daysLeft).toBeNull();
  });

  it('due never is still a position, and it remembers whether anything was ever read', () => {
    expect(dueOf(kpi({ cadence: 'manual' }), NOW).neverRead).toBe(true);
    expect(dueOf(kpi({ cadence: 'manual', current_value: 1, last_measured_at: iso(NOW) }), NOW).neverRead).toBe(false);
  });

  it('paces a promised-but-never-read KPI from created_at, which is when the promise started', () => {
    const d = dueOf(kpi({ cadence: 'weekly' }), NOW);
    // created 100 days ago, 9-day weekly window -> 91 days late
    expect(d.state).toBe('overdue');
    expect(d.daysLeft).toBe(-91);
    expect(d.neverRead).toBe(true);
  });

  it('paces a read KPI from its reading', () => {
    const d = dueOf(kpi({ cadence: 'weekly', current_value: 4, last_measured_at: iso(NOW - 30 * DAY) }), NOW);
    expect(d.daysLeft).toBe(-21);
    expect(d.neverRead).toBe(false);
  });

  it('calls a reading imminent inside a third of its own freshness window, not a fixed number of days', () => {
    // weekly: 9-day window, so imminent at 3 days left or fewer
    const weekly = dueOf(kpi({ cadence: 'weekly', current_value: 1, last_measured_at: iso(NOW - 7 * DAY) }), NOW);
    expect([weekly.state, weekly.daysLeft]).toEqual(['imminent', 2]);
    const early = dueOf(kpi({ cadence: 'weekly', current_value: 1, last_measured_at: iso(NOW - 1 * DAY) }), NOW);
    expect([early.state, early.daysLeft]).toEqual(['scheduled', 8]);
    // daily: 2-day window, so only "due today" is imminent
    const daily = dueOf(kpi({ cadence: 'daily', current_value: 1, last_measured_at: iso(NOW - 2 * DAY) }), NOW);
    expect(daily.state).toBe('imminent');
  });
});

describe('buildAlmanac', () => {
  const places = [
    {
      id: 'p1', label: 'personas', kpis: [
        kpi({ id: 'a', cadence: 'weekly' }),                                              // 91 late, never read
        kpi({ id: 'b', cadence: 'weekly', current_value: 2, last_measured_at: iso(NOW - 20 * DAY) }), // 11 late
        kpi({ id: 'c', cadence: 'manual' }),                                              // never
        kpi({ id: 'd', cadence: 'manual' }),                                              // never
      ],
    },
    {
      id: 'p2', label: 'ascent', kpis: [
        kpi({ id: 'e', cadence: 'weekly', current_value: 3, last_measured_at: iso(NOW - 1 * DAY) }), // 8 ahead
      ],
    },
  ];

  it('counts each place into the four positions and keeps the never-read share of each', () => {
    const a = buildAlmanac(places, NOW);
    const p1 = a.rows.find((r) => r.id === 'p1')!;
    expect(p1.marks.overdue.count).toBe(2);
    expect(p1.marks.overdue.neverRead).toBe(1);
    expect(p1.marks.never.count).toBe(2);
    expect(p1.marks.never.neverRead).toBe(2);
    expect(p1.marks.scheduled.count).toBe(0);
  });

  it('a mark keeps the EXTREME distance, not the mean, so the axis is honest about its worst', () => {
    const a = buildAlmanac(places, NOW);
    expect(a.rows.find((r) => r.id === 'p1')!.marks.overdue.days).toBe(91);
    expect(a.deepest).toBe(91);
    expect(a.farthest).toBe(8);
  });

  it('orders places by how late their worst KPI is, deepest debt first', () => {
    expect(buildAlmanac(places, NOW).rows.map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('a place with nothing overdue has depth 0 and sorts last without claiming a distance', () => {
    const row = buildAlmanac(places, NOW).rows.find((r) => r.id === 'p2')!;
    expect(row.depth).toBe(0);
    expect(row.marks.overdue.days).toBeNull();
  });

  it('scales height by the largest single mark, and never by zero', () => {
    expect(buildAlmanac(places, NOW).tallest).toBe(2);
    expect(buildAlmanac([], NOW).tallest).toBe(1);
  });

  it('an empty estate has no edges and no NaN', () => {
    const a = buildAlmanac([], NOW);
    expect([a.rows.length, a.deepest, a.farthest, a.total]).toEqual([0, 0, 0, 0]);
  });

  it('states the promised share against the tally the headline printed, never its own count', () => {
    const kpis = places.flatMap((p) => p.kpis);
    const a = buildAlmanac(places, NOW);
    expect(promisedShare(a, tallyKpis(kpis, NOW))).toEqual({ promised: 3, of: 5 });
  });
});
