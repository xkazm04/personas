// The estate's arithmetic. Every surface prints these numbers, so a wrong one
// is wrong in three places at once.
import { describe, expect, it } from 'vitest';

import type { DevKpi } from '@/lib/bindings/DevKpi';

import {
  buildEstate,
  freshDays,
  isStale,
  kpiAttention,
  tallyKpis,
  verdictGap,
  sortByAttention,
} from '../estate/kpiEstate';
import { moveKind, nextMoveOf } from '../estate/kpiNextMove';
import type { KpiProjectRollup } from '../kpiOverviewModel';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-21T12:00:00Z');

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

describe('freshness', () => {
  it('gives each cadence its own window and falls back for an unknown one', () => {
    expect(freshDays('daily')).toBe(2);
    expect(freshDays('weekly')).toBe(9);
    expect(freshDays(null)).toBe(30);
    expect(freshDays('fortnightly-ish')).toBe(30);
  });

  it('a KPI that was never read is DARK, never stale', () => {
    expect(isStale(kpi({ current_value: null, last_measured_at: null }), NOW)).toBe(false);
  });

  it('stale is a reading that outlived its own cadence, not just an old one', () => {
    const fresh = kpi({ current_value: 50, last_measured_at: iso(NOW - 3 * DAY) });
    const old = kpi({ current_value: 50, last_measured_at: iso(NOW - 20 * DAY) });
    expect(isStale(fresh, NOW)).toBe(false);
    expect(isStale(old, NOW)).toBe(true);
    // the same 20-day-old reading is fine on a manual cadence
    expect(isStale({ ...old, cadence: 'manual' } as DevKpi, NOW)).toBe(false);
  });
});

describe('verdictGap — what is missing before a number can be judged', () => {
  it('names a first reading, a target, a baseline or a date, and nothing when judged', () => {
    expect(verdictGap(kpi({ current_value: null }))).toBe('reading');
    expect(verdictGap(kpi({ current_value: 5, target_value: null }))).toBe('target');
    expect(verdictGap(kpi({ current_value: 5, baseline_value: null }))).toBe('baseline');
    expect(verdictGap(kpi({ current_value: 5 }))).toBe('target-date');
    expect(verdictGap(kpi({ current_value: 100 }))).toBeNull();
  });
});

describe('tallyKpis', () => {
  it('counts absence as a quantity and never lets it into the verdicts', () => {
    const t = tallyKpis(
      [
        kpi({ id: 'a', current_value: 100 }), // met
        kpi({ id: 'b', current_value: 50 }), // measured, no target date -> unpaced
        kpi({ id: 'c', current_value: null }), // never read
        kpi({ id: 'd', current_value: null }),
      ],
      NOW,
    );
    expect(t.total).toBe(4);
    expect(t.measured).toBe(2);
    expect(t.unmeasured).toBe(2);
    expect(t.met).toBe(1);
    expect(t.unpaced).toBe(1);
    expect(t.verdicts).toBe(1);
    expect(t.coverage).toBe(0.5);
  });

  it('is WATCHED, not unmeasured, when something was read but nothing can be judged', () => {
    expect(tallyKpis([kpi({ current_value: 50, target_value: null })], NOW).band).toBe('watched');
    expect(tallyKpis([kpi({ current_value: null })], NOW).band).toBe('unmeasured');
  });

  it('remembers the newest reading in the scope', () => {
    const t = tallyKpis(
      [
        kpi({ id: 'a', current_value: 1, last_measured_at: iso(NOW - 10 * DAY) }),
        kpi({ id: 'b', current_value: 1, last_measured_at: iso(NOW - 2 * DAY) }),
      ],
      NOW,
    );
    expect(t.lastReadAt).toBe(Date.parse(iso(NOW - 2 * DAY).replace(' ', 'T')));
  });
});

describe('attention — one ordering principle at every altitude', () => {
  it('weights a wrong number above a missing one', () => {
    const offTrack = kpi({ current_value: 1, target_value: 100, crit_at: 5 });
    const dark = kpi({ current_value: null });
    expect(kpiAttention(offTrack, NOW)).toBeGreaterThan(kpiAttention(dark, NOW));
  });

  it('a settled place scores zero, so it never reaches a shortlist', () => {
    expect(tallyKpis([kpi({ current_value: 100, last_measured_at: iso(NOW) })], NOW).attention).toBe(0);
  });

  it('ranks places worst first, then by the larger claim', () => {
    const place = (label: string, kpis: DevKpi[]) => ({ label, tally: tallyKpis(kpis, NOW) });
    const ranked = sortByAttention([
      place('quiet', [kpi({ current_value: 100, last_measured_at: iso(NOW) })]),
      place('dark', [kpi({ current_value: null }), kpi({ current_value: null })]),
    ]);
    expect(ranked.map((p) => p.label)).toEqual(['dark', 'quiet']);
  });
});

describe('nextMoveOf — the one sentence, in priority order', () => {
  const move = (kpis: DevKpi[]) => nextMoveOf(tallyKpis(kpis, NOW));

  it('leads with a wrong number, then a place nobody reads at all', () => {
    expect(move([kpi({ current_value: 1, crit_at: 5 }), kpi({ current_value: null })]).kind).toBe('off-track');
    expect(move([kpi({ current_value: null }), kpi({ current_value: null })]).kind).toBe('dark');
  });

  it('calls thin coverage out before anything measured-but-imperfect', () => {
    const kpis = [kpi({ id: 'a', current_value: 100 }), ...Array.from({ length: 9 }, (_, i) => kpi({ id: `d${i}`, current_value: null }))];
    expect(move(kpis).kind).toBe('thin');
  });

  it('is settled only when everything is observed and on target', () => {
    expect(move([kpi({ current_value: 100, last_measured_at: iso(NOW) })]).kind).toBe('settled');
    expect(moveKind(move([kpi({ current_value: 100, last_measured_at: iso(NOW) })]))).toBe('settled');
  });
});

describe('buildEstate', () => {
  const rollup: KpiProjectRollup[] = [
    {
      projectId: 'p1', label: 'quiet', groupsUnknown: false, total: 1, measured: 1, met: 1,
      onTrack: 0, offTrack: 0, unpaced: 0, coverage: 1, offTrackShare: 0, band: 'met',
      groups: [
        {
          key: 'p1:g1', projectId: 'p1', groupId: 'g1', label: 'g1', domain: null, color: null,
          total: 1, measured: 1, met: 1, onTrack: 0, offTrack: 0, unpaced: 0, coverage: 1,
          offTrackShare: 0, band: 'met', kpis: [kpi({ id: 'k1', current_value: 100, last_measured_at: iso(NOW) })],
        },
      ],
    },
    {
      projectId: 'p2', label: 'dark', groupsUnknown: true, total: 2, measured: 0, met: 0,
      onTrack: 0, offTrack: 0, unpaced: 0, coverage: 0, offTrackShare: null, band: 'unmeasured',
      groups: [
        {
          key: 'p2:g2', projectId: 'p2', groupId: null, label: 'Ungrouped', domain: null, color: null,
          total: 2, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0, coverage: 0,
          offTrackShare: null, band: 'unmeasured',
          kpis: [kpi({ id: 'k2', current_value: null }), kpi({ id: 'k3', current_value: null })],
        },
      ],
    },
  ];

  it('ranks the project that wants a human first, whatever the rollup order was', () => {
    const estate = buildEstate(rollup, NOW);
    expect(estate.projects.map((p) => p.label)).toEqual(['dark', 'quiet']);
  });

  it('totals the whole estate, absence included, and counts its groups', () => {
    const estate = buildEstate(rollup, NOW);
    expect(estate.tally.total).toBe(3);
    expect(estate.tally.unmeasured).toBe(2);
    expect(estate.groupCount).toBe(2);
    expect(estate.kpis).toHaveLength(3);
  });

  it('carries a failed group read through as a label, never as a grade', () => {
    expect(buildEstate(rollup, NOW).projects.find((p) => p.projectId === 'p2')?.groupsUnknown).toBe(true);
  });
});
