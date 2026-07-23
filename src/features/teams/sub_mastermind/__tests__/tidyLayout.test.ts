import { describe, it, expect } from 'vitest';

import { spiralPlace } from '../lib/hex';
import { tidyLayout, islandsOverlap, type TidyIsland, type TidyEdge } from '../lib/tidyLayout';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** A synthetic portfolio of `n` islands on the spiral (the pre-tidy layout). */
const spiralScene = (n: number): TidyIsland[] =>
  Array.from({ length: n }, (_, i) => ({ slug: `p${i}`, ...spiralPlace(i, `p${i}`) }));

const noPairOverlaps = (result: Record<string, { x: number; y: number }>) => {
  const entries = Object.values(result);
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      if (islandsOverlap(entries[a], entries[b])) return false;
    }
  }
  return true;
};

describe('tidyLayout', () => {
  it('clustering pulls connected islands closer together', () => {
    const islands: TidyIsland[] = [
      { slug: 'a', x: 0, y: 0 },
      { slug: 'b', x: 6000, y: 0 },
    ];
    const edges: TidyEdge[] = [{ from: 'a', to: 'b', strength: 1 }];
    const before = dist(islands[0], islands[1]);
    const out = tidyLayout({ islands, edges });
    expect(dist(out.a, out.b)).toBeLessThan(before);
    // …but not so close their footprints overlap.
    expect(islandsOverlap(out.a, out.b)).toBe(false);
  });

  it('keeps a connected pair closer than an unconnected island', () => {
    const islands: TidyIsland[] = [
      { slug: 'a', x: 0, y: 0 },
      { slug: 'b', x: 4000, y: 0 },
      { slug: 'c', x: 0, y: 4000 },
    ];
    const edges: TidyEdge[] = [{ from: 'a', to: 'b', strength: 1 }];
    const out = tidyLayout({ islands, edges });
    // a↔b are wired; c is not wired to anyone → a↔b end up nearer than a↔c.
    expect(dist(out.a, out.b)).toBeLessThan(dist(out.a, out.c));
  });

  it('resolves overlap — coincident islands are separated', () => {
    const islands: TidyIsland[] = [
      { slug: 'a', x: 100, y: 100 },
      { slug: 'b', x: 100, y: 100 },
      { slug: 'c', x: 100, y: 100 },
    ];
    const out = tidyLayout({ islands, edges: [] });
    expect(noPairOverlaps(out)).toBe(true);
  });

  it('leaves no overlapping footprints across a 24-island portfolio', () => {
    const islands = spiralScene(24);
    // A handful of relations so clustering is exercised, not just repulsion.
    const edges: TidyEdge[] = [
      { from: 'p0', to: 'p1', strength: 1 },
      { from: 'p0', to: 'p5', strength: 1 },
      { from: 'p3', to: 'p8', strength: 0.7 },
      { from: 'p10', to: 'p11', strength: 1 },
    ];
    const out = tidyLayout({ islands, edges });
    expect(Object.keys(out)).toHaveLength(24);
    expect(noPairOverlaps(out)).toBe(true);
  });

  it('never moves a pinned island', () => {
    const islands: TidyIsland[] = [
      { slug: 'anchor', x: 1234, y: -777 },
      { slug: 'a', x: 1234, y: -777 }, // starts ON the anchor → must be pushed off it
      { slug: 'b', x: 3000, y: 3000 },
    ];
    const edges: TidyEdge[] = [
      { from: 'anchor', to: 'a', strength: 1 },
      { from: 'anchor', to: 'b', strength: 1 },
    ];
    const out = tidyLayout({ islands, edges, pinned: new Set(['anchor']) });
    expect(out.anchor).toEqual({ x: 1234, y: -777 });
    // the non-pinned neighbour was moved clear of the anchor
    expect(islandsOverlap(out.anchor, out.a)).toBe(false);
  });

  it('is deterministic — identical input yields identical output', () => {
    const islands = spiralScene(12);
    const edges: TidyEdge[] = [
      { from: 'p1', to: 'p2', strength: 1 },
      { from: 'p4', to: 'p7', strength: 0.6 },
      { from: 'p2', to: 'p9', strength: 0.9 },
    ];
    const groups = [{ members: ['p1', 'p2', 'p9'] }];
    const a = tidyLayout({ islands, edges, groups });
    const b = tidyLayout({ islands, edges, groups });
    expect(a).toEqual(b);
  });

  it('respects the iteration clamp (≤120) without throwing', () => {
    const islands = spiralScene(6);
    const out = tidyLayout({ islands, edges: [], iterations: 10_000 });
    expect(Object.keys(out)).toHaveLength(6);
    expect(noPairOverlaps(out)).toBe(true);
  });

  it('keeps grouped members contiguous (tighter than the whole spread)', () => {
    const islands = spiralScene(16);
    const groupMembers = ['p2', 'p6', 'p11'];
    const out = tidyLayout({ islands, edges: [], groups: [{ members: groupMembers }] });
    // Mean pairwise distance within the group is well under the layout diameter.
    const groupPts = groupMembers.map((s) => out[s]);
    let groupSum = 0, groupN = 0;
    for (let i = 0; i < groupPts.length; i++) {
      for (let j = i + 1; j < groupPts.length; j++) { groupSum += dist(groupPts[i], groupPts[j]); groupN++; }
    }
    const all = Object.values(out);
    let maxD = 0;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) maxD = Math.max(maxD, dist(all[i], all[j]));
    }
    expect(groupSum / groupN).toBeLessThan(maxD);
  });
});
