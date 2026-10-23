/**
 * Time travel, pure (spark bp-fidelity, WP-D2), over the Kettle fixture: the engine draws each feature in the stage the
 * events log gives it on the travelled date (bp stageAt), a feature added later is not drawn yet, now is the map's own
 * stage; the place counts fold the replayed stages; the recent window follows the View's days; and the sliders' one
 * x <-> time mapping (a drag lands on a week, snaps to now at the right end, a key steps a week and End is now).
 */
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { countsAt, deltaWin, revAt, stageOfAt } from '../engine/travel';
import { asOfFor, dateAt, histX, sliderKey, stepWeek, stops } from '../ui/timeline/scrub';

const data = kettleData();
const plan = buildPlan(data.structure, data.events);
const S = plan.S;

describe('the plan at a date', () => {
  it('draws now as the map says, and a past date as the last revision at or before it', () => {
    const early = S.weeks[2]!;
    let replayed = 0, notYet = 0;
    for (const f of S.features) {
      expect(stageOfAt(f, null, S.asOf)).toBe(f.stage);
      const want = f.revs.filter((r) => r.date <= early).pop()?.stage ?? null;
      expect(stageOfAt(f, early, S.asOf)).toBe(want);
      if (want === null) notYet++; else if (want !== f.stage) replayed++;
    }
    // the fixture's history is real enough that a date three weeks in differs: some features older, some not drawn yet
    expect(replayed + notYet).toBeGreaterThan(0);
  });
  it('folds the replayed stages into the place counts, every feature counted once', () => {
    const early = S.weeks[1]!, now = countsAt(S.features, (f) => f.stage), then = countsAt(S.features, (f) => stageOfAt(f, early, S.asOf));
    for (const c of [now, then]) expect(c.live + c.flagged + c.build + c.paper + c.dep + c.none).toBe(S.features.length);
    expect(then.none).toBeGreaterThanOrEqual(now.none);
    expect(then.live + then.flagged).toBeLessThanOrEqual(now.live + now.flagged);
  });
  it('flies the delta mark for a stage moved inside the View window, which widens with the days', () => {
    const in7 = S.features.filter((f) => deltaWin(f, S.asOf, 7)).length, in30 = S.features.filter((f) => deltaWin(f, S.asOf, 30)).length;
    expect(in30).toBeGreaterThanOrEqual(in7);
    for (const f of S.features) { const r = deltaWin(f, S.asOf, 30); if (r) expect(r.date <= S.asOf).toBe(true); }
  });
  it('numbers a date by its revision, 1 at the least', () => {
    expect(revAt(S.weeks, S.asOf)).toBe(S.weeks.filter((w) => w <= S.asOf).length);
    expect(revAt(S.weeks, '1970-01-01')).toBe(1);
  });
});

describe('the time sliders', () => {
  const g = { h0: 0, h1: 600, weeks: S.weeks, asOf: S.asOf };
  it('lands a drag on the nearest week and snaps to now at the right end', () => {
    expect(dateAt(g, 600)).toBe(S.asOf);
    expect(dateAt(g, 0)).toBe(S.weeks[0]);
    const w = S.weeks[5]!;
    expect(dateAt(g, histX(g, w) + 0.5)).toBe(w);
  });
  it('steps a week with the arrows, Home to the first week, End to now, and claims Enter without moving', () => {
    const s = stops(g), mid = s[4]!;
    expect(sliderKey('ArrowLeft', g, mid)).toBe(s[3]);
    expect(sliderKey('ArrowRight', g, mid)).toBe(s[5]);
    expect(sliderKey('Home', g, mid)).toBe(s[0]);
    expect(sliderKey('End', g, mid)).toBe(S.asOf);
    expect(sliderKey('Enter', g, mid)).toBe(mid);
    expect(sliderKey('a', g, mid)).toBeUndefined();
    expect(stepWeek(g, S.asOf, 1)).toBe(S.asOf);
  });
  it('sends null at now and the date before it', () => {
    expect(asOfFor(S.asOf, S.asOf)).toBeNull();
    expect(asOfFor(S.asOf, S.weeks[0]!)).toBe(S.weeks[0]);
  });
});
