import { describe, it, expect } from 'vitest';
import { applyOrder, canDrag, meanWaitMs, nudgePayload, reEstimate, reorderPayload } from '../queueVerbs';

const q = (id: string, locked = false, rank: number | null = null, est: number | null = null) =>
  ({ sessionId: id, locked, rank, estimatedStartMs: est });

describe('canDrag', () => {
  it('is the inverse of locked', () => {
    expect(canDrag(q('a'))).toBe(true);
    expect(canDrag(q('a', true))).toBe(false);
  });
});

describe('reorderPayload', () => {
  const items = [q('a'), q('b'), q('c'), q('d')];

  it('moves a row to the target position and returns the FULL id list', () => {
    expect(reorderPayload(items, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderPayload(items, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('is a no-op for the same id, an unknown id, or a locked row', () => {
    expect(reorderPayload(items, 'a', 'a')).toBeNull();
    expect(reorderPayload(items, 'a', 'zz')).toBeNull();
    expect(reorderPayload([q('a', true), q('b')], 'a', 'b')).toBeNull();
    expect(reorderPayload([q('a'), q('b', true)], 'a', 'b')).toBeNull();
  });
});

describe('nudgePayload', () => {
  const items = [q('a'), q('b'), q('c')];
  it('steps one position and refuses at the edges', () => {
    expect(nudgePayload(items, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(nudgePayload(items, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(nudgePayload(items, 'a', -1)).toBeNull();
    expect(nudgePayload(items, 'c', 1)).toBeNull();
    expect(nudgePayload(items, 'zz', 1)).toBeNull();
  });
});

describe('applyOrder', () => {
  it('reorders locally, renumbers ranks densely from 1, and keeps unlisted rows at the tail', () => {
    const items = [q('a', false, 1), q('b', false, 2), q('c', false, 3)];
    const out = applyOrder(items, ['c', 'a']);
    expect(out.map((i) => i.sessionId)).toEqual(['c', 'a', 'b']);
    expect(out.map((i) => i.rank)).toEqual([1, 2, 3]);
  });
});

describe('meanWaitMs / reEstimate', () => {
  it('recovers the door mean from a ranked, estimated row and re-projects by new rank', () => {
    const now = 100_000;
    const before = [q('a', false, 1, now + 30_000), q('b', false, 2, now + 60_000)];
    const mean = meanWaitMs(before, now);
    expect(mean).toBe(30_000);
    const after = reEstimate(applyOrder(before, ['b', 'a']), now, mean);
    expect(after.map((i) => i.sessionId)).toEqual(['b', 'a']);
    expect(after.map((i) => i.estimatedStartMs)).toEqual([now + 30_000, now + 60_000]);
  });

  it('yields null estimates when the door had no history', () => {
    const items = [q('a', false, 1), q('b', false, 2)];
    expect(meanWaitMs(items, 0)).toBeNull();
    expect(reEstimate(items, 0, null).map((i) => i.estimatedStartMs)).toEqual([null, null]);
  });
});
