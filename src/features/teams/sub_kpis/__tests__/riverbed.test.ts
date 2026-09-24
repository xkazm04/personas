// The river's honesty rules, which are geometry rather than annotation.
import { describe, expect, it } from 'vitest';

import type { WeeklyState } from '../kpiSample';
import { describeFlow, toRiverbed, waterHalfWidth, wetRuns } from '../variants/river/riverbed';

const WEEK = 7 * 86_400_000;
const MONDAY = Date.UTC(2026, 6, 6);

function week(i: number, over: Partial<WeeklyState> = {}): WeeklyState {
  return { week: MONDAY + i * WEEK, met: 0, onTrack: 0, offTrack: 0, measured: 0, partial: false, ...over };
}

describe('toRiverbed', () => {
  it('keeps the bed at the DECLARED width whatever the water does', () => {
    const bed = toRiverbed([week(0, { measured: 3, met: 3 }), week(1)], 500);
    expect(bed.declared).toBe(500);
    expect(bed.points).toHaveLength(2);
  });

  it('counts a week with no reading as DRY, never as a zero verdict', () => {
    const bed = toRiverbed([week(0), week(1, { measured: 2, met: 2 }), week(2)], 10);
    expect(bed.dryWeeks).toBe(2);
    expect(bed.points[0]!.read).toBe(0);
    expect(bed.points[0]!.met).toBe(0);
  });

  it('calls what was read but not judged SILT, outside the verdicts', () => {
    const bed = toRiverbed([week(0, { measured: 5, met: 1, onTrack: 1, offTrack: 1 })], 10);
    expect(bed.points[0]!.silt).toBe(2);
  });

  it('reports the fullest CLOSED week, never the open one', () => {
    const bed = toRiverbed(
      [week(0, { measured: 4, met: 4 }), week(1, { measured: 9, met: 9, partial: true })],
      20,
    );
    expect(bed.peak?.read).toBe(4);
    expect(bed.latest?.read).toBe(9);
  });

  it('has no peak at all when nothing was ever read', () => {
    expect(toRiverbed([week(0), week(1)], 10).peak).toBeNull();
  });
});

describe('waterHalfWidth', () => {
  it('is zero for a dry week and never exceeds the bed', () => {
    expect(waterHalfWidth(0, 100)).toBe(0);
    expect(waterHalfWidth(200, 100)).toBe(0.5);
  });

  it('keeps a small river visible beside a large one (square root, not linear)', () => {
    // 1 % of the bed would be a 0.5 % half-width linearly; the root gives 5 %.
    expect(waterHalfWidth(1, 100)).toBeCloseTo(0.05, 5);
  });
});

describe('wetRuns — a gap breaks the path, it is never drawn across', () => {
  it('splits the series at every dry week', () => {
    const bed = toRiverbed(
      [
        week(0, { measured: 1, met: 1 }),
        week(1),
        week(2, { measured: 2, met: 2 }),
        week(3, { measured: 3, met: 3 }),
      ],
      10,
    );
    const runs = wetRuns(bed.points);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(1);
    expect(runs[1]).toHaveLength(2);
  });

  it('is empty when every week is dry', () => {
    expect(wetRuns(toRiverbed([week(0), week(1)], 10).points)).toHaveLength(0);
  });
});

describe('describeFlow — the sentence under every tributary', () => {
  const flow = (states: WeeklyState[], declared = 100) => describeFlow(toRiverbed(states, declared));

  it('says NEVER when the bed has never held water', () => {
    expect(flow([week(0), week(1), week(2)]).kind).toBe('never');
  });

  it('describes a river that has just arrived by its arrival, not by a trend', () => {
    const f = flow([week(0), week(1), week(2), week(3, { measured: 7, met: 7 })]);
    expect(f.kind).toBe('first-water');
    expect(f.read).toBe(7);
  });

  it('calls a shrinking river narrowing and a growing one widening', () => {
    const base = [week(0, { measured: 9, met: 9 }), week(1, { measured: 8, met: 8 }), week(2, { measured: 5, met: 5 })];
    expect(flow(base).kind).toBe('narrowing');
    expect(flow([...base].reverse().map((w, i) => ({ ...w, week: MONDAY + i * WEEK }))).kind).toBe('widening');
  });

  it('calls a river that stopped QUIET, and says how long ago', () => {
    const f = flow([week(0, { measured: 4, met: 4 }), week(1), week(2)]);
    expect(f.kind).toBe('quiet');
    expect(f.weeksAgo).toBe(2);
  });
});

describe('describeFlow — "never" is a claim about the estate, not about the window', () => {
  const dry = toRiverbed([week(0), week(1), week(2)], 27);

  it('says NEVER only when nothing has ever been read anywhere', () => {
    expect(describeFlow(dry, 0).kind).toBe('never');
  });

  it('says the readings predate the window when the scope HAS been measured', () => {
    // 27 of 27 measured, but every reading is older than twelve weeks: calling
    // this "never had a reading" is the lie the surface exists to stop.
    const f = describeFlow(dry, 27);
    expect(f.kind).toBe('before-window');
    expect(f.to).toBe(27);
  });
});
