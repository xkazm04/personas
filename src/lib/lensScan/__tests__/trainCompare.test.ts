// @vitest-environment node
/**
 * PORTED from bp scripts/check-train-compare.ts @ 48171a1 (spark one-control, Stage 2, WP4b): the compare panel's
 * performance maths (the blueprint's port of bp src/lib/train/perf.ts) beside the verdict it sits next to
 * (compare.ts verdictOf):
 *   - Athena's real experiment (interaction p95, 3 baseline runs) 80/88/80 -> 64 and 80/184/80 -> 88 are flat (within
 *     the one-frame floor, within the spread), the Kettle sample's 96/104/98 -> 72 moved; median, spread, noise,
 *     change, %, the outlier rule (more than noise/2 above the median), the frame flag, the range scale, signed figures.
 * NOT ported: bp's pixel checks (src/lib/train/pixels.ts). The change map they cover is not part of the Personas
 * compare panel (blueprint/PARITY.md, WP4b): there is no pixel code here for them to test.
 */
import { describe, expect, it } from 'vitest';
import { verdictOf, type LensFields } from '../compare';
import type { Measurement, Proposal } from '../wire';
import { atTarget, beyondNoise, isOutlier, perfFigures, rangeScale, signed } from '@/features/decision-center/blueprint/model/perf';

const LENSES: LensFields[] = [{ id: 'performance', manifest: { fields: [{ key: 'interactionP95Ms', metric: { better: 'down' } }] } }];
const P: Proposal = { id: 'p-x', run_id: 'r', feature: 'f', lens: 'performance', metric: 'interactionP95Ms', title: 't', standard: 's', kind: 'fix', status: 'done', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
let mid = 0;
const reading = (value: number, phase: 'before' | 'after', i: number): Measurement => ({
  id: ++mid, run_id: 'r', feature: 'f', lens: 'performance', metric: 'interactionP95Ms', value, unit: 'ms', method: 'probe',
  measured_at: `2026-10-15T00:0${i}:00Z`, proposal_id: 'p-x', phase,
});
function judge(runs: number[], after: number) {
  const before = runs.map((v, i) => reading(v, 'before', i)), aft = [reading(after, 'after', 8)];
  return { v: verdictOf(P, before, aft, LENSES).verdict, f: perfFigures(runs, after, 'ms') };
}

describe('perf: baseline runs against the after (bp check-train-compare)', () => {
  it('Athena 80/88/80 -> 64 is flat, within the one-frame floor', () => {
    const { v, f } = judge([80, 88, 80], 64);
    expect(v).toBe('flat');
    expect(f.median).toBe(80);
    expect(f.spread).toBe(8);
    expect(f.noise).toBeCloseTo(16.7, 9);
    expect(f.frame).toBe(true);
    expect(f.change).toBe(-16);
    expect(f.pct).toBeCloseTo(-20, 9);
    expect(beyondNoise(f)).toBe(false);
    expect(f.outlier.every((x) => !x)).toBe(true);
  });

  it('Athena 80/184/80 -> 88 is flat, within the spread; 184 is the outlier run', () => {
    const { v, f } = judge([80, 184, 80], 88);
    expect(v).toBe('flat');
    expect([f.median, f.spread, f.noise, f.frame]).toEqual([80, 104, 104, false]);
    expect(f.change).toBe(8);
    expect(f.pct).toBeCloseTo(10, 9);
    expect(isOutlier(184, f)).toBe(true);
    expect(isOutlier(80, f)).toBe(false);
    expect(f.outlier.join()).toBe('false,false,true');
  });

  it('the Kettle sample 96/104/98 -> 72 moved; the range scale runs 0..max x 1.08, clamped', () => {
    const { v, f } = judge([96, 104, 98], 72);
    expect(v).toBe('moved');
    expect(f.median).toBe(98);
    expect(f.noise).toBeCloseTo(16.7, 9);
    expect(f.change).toBe(-26);
    expect(beyondNoise(f)).toBe(true);
    const s = rangeScale(f, 100, 200);
    expect(s.max).toBeCloseTo(216, 9);
    expect([s.x(108), s.x(0), s.x(500)]).toEqual(['50.00%', '0.00%', '100.00%']);
  });

  it('a worse change, one reading, and no runs at all', () => {
    expect(judge([50, 52, 51], 90).v).toBe('worse');
    const one = perfFigures([40], 30, 'ms');
    expect([one.noise, one.frame, one.median]).toEqual([0, false, 40]);
    const none = perfFigures([], undefined, 'ms');
    expect(Number.isNaN(none.median)).toBe(true);
    expect(none.change).toBeUndefined();
  });

  it('signed figures and the target direction', () => {
    expect([signed(8), signed(-16), signed(0), signed(-2.25)]).toEqual(['+8', '−16', '±0', '−2.3']);
    expect(atTarget(90, 100)).toBe(true);
    expect(atTarget(110, 100)).toBe(false);
    expect(atTarget(110, 100, 'up')).toBe(true);
  });
});
