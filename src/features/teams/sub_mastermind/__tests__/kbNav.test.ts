import { describe, expect, it } from 'vitest';

import { nearestTo, pickInDirection } from '../lib/kbNav';
import type { Island } from '../lib/types';

/** Minimal island — kbNav only reads slug/x/y. */
const at = (slug: string, x: number, y: number) => ({ slug, x, y }) as Island;

//        up
//         │
//  left ──┼── right      (screen axes: +y is DOWN)
//         │
//       down
const RIGHT = [1, 0] as const;
const LEFT = [-1, 0] as const;
const DOWN = [0, 1] as const;
const UP = [0, -1] as const;

describe('pickInDirection', () => {
  const centre = at('centre', 0, 0);
  const grid = [
    centre,
    at('right', 1000, 0),
    at('left', -1000, 0),
    at('down', 0, 1000),
    at('up', 0, -1000),
  ];

  it('moves to the island on the pressed axis', () => {
    expect(pickInDirection(grid, centre, ...RIGHT)?.slug).toBe('right');
    expect(pickInDirection(grid, centre, ...LEFT)?.slug).toBe('left');
    expect(pickInDirection(grid, centre, ...DOWN)?.slug).toBe('down');
    expect(pickInDirection(grid, centre, ...UP)?.slug).toBe('up');
  });

  it('never returns the island it started from', () => {
    for (const dir of [RIGHT, LEFT, DOWN, UP]) {
      expect(pickInDirection(grid, centre, ...dir)?.slug).not.toBe('centre');
    }
  });

  it('prefers the aligned island over a nearer one well off the axis', () => {
    // `askew` is closer in raw distance but sits far off the rightward axis;
    // `aligned` is further yet is what "right" should mean.
    const islands = [centre, at('askew', 300, 900), at('aligned', 700, 40)];
    expect(pickInDirection(islands, centre, ...RIGHT)?.slug).toBe('aligned');
  });

  it('ignores candidates behind the cursor', () => {
    const islands = [centre, at('behind', -100, 0), at('ahead', 5000, 0)];
    expect(pickInDirection(islands, centre, ...RIGHT)?.slug).toBe('ahead');
  });

  it('falls back to the nearest island when the direction cone is empty', () => {
    // Nothing to the right at all — the cursor must not be trapped.
    const islands = [centre, at('far-left', -4000, 0), at('near-left', -600, 0)];
    expect(pickInDirection(islands, centre, ...RIGHT)?.slug).toBe('near-left');
  });

  it('returns null when there is nowhere to go', () => {
    expect(pickInDirection([centre], centre, ...RIGHT)).toBeNull();
  });

  it('reaches every island in a single-column map, in both directions', () => {
    // A vertical stack has an empty left/right cone at every step; walking down
    // and back up must still visit each island exactly once.
    const column = [at('a', 0, 0), at('b', 0, 500), at('c', 0, 1000)];
    let cur = column[0];
    const walked = [cur.slug];
    for (let n = 0; n < 2; n++) {
      cur = pickInDirection(column, cur, ...DOWN)!;
      walked.push(cur.slug);
    }
    expect(walked).toEqual(['a', 'b', 'c']);
    expect(pickInDirection(column, cur, ...UP)?.slug).toBe('b');
  });

  it('treats a diagonal neighbour as reachable from both of its axes', () => {
    const islands = [centre, at('diag', 800, 700)];
    expect(pickInDirection(islands, centre, ...RIGHT)?.slug).toBe('diag');
    expect(pickInDirection(islands, centre, ...DOWN)?.slug).toBe('diag');
  });
});

describe('nearestTo', () => {
  it('picks the island closest to a world point', () => {
    const islands = [at('a', 0, 0), at('b', 900, 0), at('c', 0, 900)];
    expect(nearestTo(islands, 800, 50)?.slug).toBe('b');
    expect(nearestTo(islands, 20, 20)?.slug).toBe('a');
  });

  it('returns null for an empty map', () => {
    expect(nearestTo([], 0, 0)).toBeNull();
  });
});
