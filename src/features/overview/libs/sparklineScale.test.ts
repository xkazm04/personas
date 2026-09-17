import { describe, it, expect } from 'vitest';
import { sparklineDomain, sparklinePoints } from './sparklineScale';

const H = 16;
const W = 32;
/** Y of the last point, as a fraction of the box height from the FLOOR. */
const lastHeight = (points: string) => {
  const y = Number(points.split(' ').pop()!.split(',')[1]);
  return (H - y) / H;
};

// Four KpiTiles in one grid each mapped their own series onto its own
// min..max, so amplitude meant "this tile had a range" rather than "this
// moved". These cases pin the scale policy that makes sibling sparklines
// comparable.
describe('sparklineDomain', () => {
  it('auto fits the sample, as the original behaviour did', () => {
    expect(sparklineDomain([99.1, 99.3], 'auto')).toEqual({ min: 99.1, max: 99.3 });
  });

  it('zero anchors the floor at 0 so height is proportional to magnitude', () => {
    expect(sparklineDomain([10, 50], 'zero')).toEqual({ min: 0, max: 50 });
  });

  it('zero still shows a series that dips negative instead of clipping it', () => {
    expect(sparklineDomain([-5, 10], 'zero')).toEqual({ min: -5, max: 10 });
  });

  it('an explicit domain wins over the sample', () => {
    expect(sparklineDomain([99.1, 99.3], { min: 0, max: 100 })).toEqual({ min: 0, max: 100 });
  });
});

describe('sparklinePoints', () => {
  it('(a) a percent series on 0-100 is nearly flat, where auto filled the box', () => {
    const percent = [99.1, 99.3];
    expect(lastHeight(sparklinePoints(percent, 'auto', W, H)!)).toBe(1);
    expect(lastHeight(sparklinePoints(percent, { min: 0, max: 100 }, W, H)!)).toBeCloseTo(0.993, 3);
    // The point is the DIFFERENCE between the two tiles, not the absolute
    // height: on 0-100 the two samples are visually identical, which is the
    // truth about a 0.2-point move.
    const [first, last] = sparklinePoints(percent, { min: 0, max: 100 }, W, H)!.split(' ');
    expect(Math.abs(Number(last!.split(',')[1]) - Number(first!.split(',')[1]))).toBeLessThan(0.05);
  });

  it('(b) a zero-anchored cost series keeps its amplitude', () => {
    const points = sparklinePoints([10, 50], 'zero', W, H)!.split(' ');
    expect(lastHeight(points.join(' '))).toBe(1);
    expect(Number(points[0]!.split(',')[1])).toBeCloseTo(H - 0.2 * H, 5);
  });

  it('(c) two tiles that share a domain are drawn on the same axis', () => {
    const domain = { min: 0, max: 50 };
    const a = sparklinePoints([10, 20], domain, W, H)!;
    const b = sparklinePoints([40, 50], domain, W, H)!;
    // Same shape, different heights — which is the whole point of a shared
    // domain. Under 'auto' both would have spanned the full box.
    expect(lastHeight(a)).toBeCloseTo(0.4, 5);
    expect(lastHeight(b)).toBeCloseTo(1, 5);
  });

  it('(d) fewer than two points renders nothing', () => {
    expect(sparklinePoints([], 'auto', W, H)).toBeNull();
    expect(sparklinePoints([5], 'zero', W, H)).toBeNull();
  });

  it('draws a flat series at the floor, not at half height', () => {
    expect(lastHeight(sparklinePoints([7, 7], 'auto', W, H)!)).toBe(0);
  });

  it('clamps a point that falls outside an explicit domain', () => {
    const points = sparklinePoints([-20, 140], { min: 0, max: 100 }, W, H)!.split(' ');
    expect(Number(points[0]!.split(',')[1])).toBe(H);
    expect(Number(points[1]!.split(',')[1])).toBe(0);
  });
});
