// The status bar names exactly ONE milestone out of the whole workspace, so
// the ordering IS the feature: get it wrong and the bar confidently points at
// the wrong thing, which is worse than not existing. These lock the four rules
// and the two "not actually open" exclusions.
import { describe, expect, it } from 'vitest';

import { openMilestones } from '../lib/MilestoneStatusBar';
import type { Island, IslandShip } from '../lib/types';

const ship = (over: Partial<IslandShip>): IslandShip => ({
  next: 'M1', nextStatus: 'planned', shipped: 0, total: 3,
  targetDate: null, forecastDate: null, late: false, ...over,
});

const island = (slug: string, s: IslandShip | null): Island => ({
  slug, name: slug, purpose: '', x: 0, y: 0, state: 'ok',
  autoScore: 0, prodScore: 0, lifecycle: '', automationLabel: '', blockers: 0,
  nodes: [], fleet: [], personasRunning: [], runners: [], attention: false,
  monitorErrors: null, stateSource: 'readiness', stats: [], ship: s,
} as unknown as Island);

describe('openMilestones', () => {
  it('drops projects with no milestones and projects that have shipped them all', () => {
    const rows = openMilestones([
      island('none', null),
      island('no-rows', ship({ next: null, nextStatus: null, total: 0 })),
      // Everything shipped: the roadmap exists, but there is no NEXT.
      island('done', ship({ next: null, nextStatus: null, shipped: 3, total: 3 })),
      island('live', ship({ next: 'M2' })),
    ]);
    expect(rows.map((r) => r.slug)).toEqual(['live']);
  });

  it('puts a late milestone first even when another is cut and due sooner', () => {
    const rows = openMilestones([
      island('soon', ship({ nextStatus: 'active', targetDate: '2026-01-01' })),
      island('late', ship({ nextStatus: 'planned', targetDate: '2027-12-31', late: true })),
    ]);
    expect(rows[0]?.slug).toBe('late');
  });

  it('prefers a cut milestone over a merely planned one', () => {
    const rows = openMilestones([
      island('planned', ship({ nextStatus: 'planned' })),
      island('cut', ship({ nextStatus: 'active' })),
    ]);
    expect(rows[0]?.slug).toBe('cut');
  });

  it('orders by date, and a dated milestone outranks an undated one', () => {
    const rows = openMilestones([
      island('undated', ship({ nextStatus: 'active' })),
      island('later', ship({ nextStatus: 'active', targetDate: '2026-06-01' })),
      island('sooner', ship({ nextStatus: 'active', targetDate: '2026-03-01' })),
    ]);
    expect(rows.map((r) => r.slug)).toEqual(['sooner', 'later', 'undated']);
  });

  it('falls back to a forecast date when no target was committed', () => {
    const rows = openMilestones([
      island('forecast-late', ship({ nextStatus: 'active', forecastDate: '2026-09-01' })),
      island('target-early', ship({ nextStatus: 'active', targetDate: '2026-04-01' })),
    ]);
    expect(rows.map((r) => r.slug)).toEqual(['target-early', 'forecast-late']);
  });

  it('is stable on a total tie, so the bar does not reshuffle between renders', () => {
    const tie = [island('b', ship({})), island('a', ship({}))];
    expect(openMilestones(tie).map((r) => r.slug)).toEqual(['a', 'b']);
    expect(openMilestones([...tie].reverse()).map((r) => r.slug)).toEqual(['a', 'b']);
  });
});
