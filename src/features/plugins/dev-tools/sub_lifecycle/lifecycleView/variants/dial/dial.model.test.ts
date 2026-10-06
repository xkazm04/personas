import { describe, expect, it } from 'vitest';

import { buildLanes } from '../../../journey/journeyModel';
import { soloV0, stepView } from '../../../journey/__tests__/fixtures';
import { CENTRE, LABEL_R, RING_R, SIZE, arcPath, dialSpokes, enforcedCount, polar } from './dial.model';

function orderOf(snap = soloV0()) {
  const lanes = buildLanes(snap);
  return { order: [...lanes.before, ...lanes.after], afterStart: lanes.before.length };
}

describe('dial.model', () => {
  it('puts 12 o\'clock at the top and runs clockwise', () => {
    const top = polar(RING_R, 0);
    expect(top.x).toBeCloseTo(CENTRE, 5);
    expect(top.y).toBeCloseTo(CENTRE - RING_R, 5);
    const quarter = polar(RING_R, 90);
    expect(quarter.x).toBeCloseTo(CENTRE + RING_R, 5);
    expect(quarter.y).toBeCloseTo(CENTRE, 5);
  });

  it('gives every step an equal slot in journey order', () => {
    const { order, afterStart } = orderOf();
    const spokes = dialSpokes(order, afterStart);
    expect(spokes.map((s) => s.node.id)).toEqual(order.map((n) => n.id));
    const slot = 360 / order.length;
    spokes.forEach((s, i) => expect(s.mid).toBeCloseTo((i + 0.5) * slot, 5));
    expect(spokes[0]?.mid).toBeLessThan(90);
  });

  it('opens a wider gap at both lane boundaries than inside a lane', () => {
    const { order, afterStart } = orderOf();
    const spokes = dialSpokes(order, afterStart);
    const slot = 360 / order.length;
    const insideLane = (spokes[1]!.from % slot);
    const atBoundary = (spokes[afterStart]!.from % slot);
    expect(atBoundary).toBeGreaterThan(insideLane);
    // The ring closes, so the last step also ends on the wide pad.
    expect(spokes.at(-1)!.to).toBeLessThan(360 - 5);
  });

  it('keeps every caption inside the box', () => {
    const { order, afterStart } = orderOf();
    for (const s of dialSpokes(order, afterStart)) {
      expect(s.labelX * SIZE).toBeGreaterThan(CENTRE - LABEL_R - 1);
      expect(s.labelX * SIZE).toBeLessThan(CENTRE + LABEL_R + 1);
      expect(s.x).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(1);
    }
  });

  it('draws a short clockwise arc with no large-arc flag', () => {
    expect(arcPath(RING_R, 10, 40)).toMatch(/^M [\d.]+ [\d.]+ A 100 100 0 0 1 [\d.]+ [\d.]+$/);
  });

  it('counts only live steps as enforced, never detected', () => {
    const { order } = orderOf();
    expect(enforcedCount(order)).toBe(5);
    const { order: one } = orderOf(soloV0({ steps: [stepView('gate', 'after', [['hook', 'detected']])] }));
    expect(enforcedCount(one)).toBe(0);
    expect(dialSpokes([], 0)).toEqual([]);
  });
});
