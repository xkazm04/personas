/**
 * The queue's honesty properties. Each `describe` below pins one defect that
 * shipped: a skip loop with no end, a progress readout that could exceed its
 * own total, and filter chips counting rows that had already been decided.
 */
import { describe, it, expect } from 'vitest';

import { MAX_SKIP_PASSES, projectQueue, skipCount, withSkip } from '../triageQueue';
import { ALL_KINDS, makeItem } from './triageFixtures';

const NO_SKIPS = new Map<string, number>();

function project(
  all: ReturnType<typeof makeItem>[],
  opts: {
    resolved?: string[];
    skips?: Map<string, number>;
    kinds?: Set<'review' | 'idea' | 'practice' | 'question'>;
  } = {},
) {
  return projectQueue({
    all,
    resolved: new Set(opts.resolved ?? []),
    skips: opts.skips ?? NO_SKIPS,
    activeKinds: opts.kinds ?? ALL_KINDS,
  });
}

describe('projectQueue — ordering', () => {
  it('deals undecided first, skipped last, weight order within each band', () => {
    const light = makeItem('idea', { weight: 10 });
    const heavy = makeItem('review', { weight: 90 });
    const mid = makeItem('practice', { weight: 50 });

    const skips = withSkip(NO_SKIPS, heavy.id);
    const { items } = project([light, heavy, mid], { skips });

    expect(items.map((i) => i.id)).toEqual([mid.id, light.id, heavy.id]);
  });

  it('drops resolved items entirely', () => {
    const a = makeItem('idea');
    const b = makeItem('idea');
    const { items } = project([a, b], { resolved: [a.id] });
    expect(items.map((i) => i.id)).toEqual([b.id]);
  });
});

describe('projectQueue — a skip terminates (the wedge that never cleared)', () => {
  it('re-presents a skipped item, but only up to MAX_SKIP_PASSES', () => {
    const only = makeItem('idea');
    let skips = NO_SKIPS as Map<string, number>;

    // Pass 1: skipped, still dealt — "not now" must not mean "gone".
    skips = withSkip(skips, only.id);
    expect(project([only], { skips }).items).toHaveLength(1);

    // Pass 2 (== MAX_SKIP_PASSES): stands down, and the deck can finish.
    skips = withSkip(skips, only.id);
    expect(skipCount(skips, only.id)).toBe(MAX_SKIP_PASSES);
    expect(project([only], { skips }).items).toHaveLength(0);
  });

  it('reaches the cleared state after a finite number of skips', () => {
    const items = [makeItem('idea'), makeItem('review'), makeItem('practice')];
    let skips = NO_SKIPS as Map<string, number>;
    let dealt = project(items, { skips }).items;
    let passes = 0;

    // Simulate a reviewer who only ever skips. Before the fix this loop never
    // terminated: the queue re-dealt the same card forever.
    while (dealt.length > 0 && passes < 100) {
      skips = withSkip(skips, dealt[0].id);
      dealt = project(items, { skips }).items;
      passes += 1;
    }

    expect(dealt).toHaveLength(0);
    expect(passes).toBe(items.length * MAX_SKIP_PASSES);
  });

  it('counts stood-down items as deferred, not decided', () => {
    const only = makeItem('idea');
    const skips = withSkip(withSkip(NO_SKIPS, only.id), only.id);
    const projection = project([only], { skips });

    expect(projection.deferredCount).toBe(1);
    expect(projection.items).toHaveLength(0);
    // Still in the denominator: the reviewer saw it and declined to decide.
    expect(projection.sessionTotal).toBe(1);
  });
});

describe('projectQueue — the progress readout cannot lie', () => {
  it('never reports a total below the decided count, even as polls drop rows', () => {
    const a = makeItem('review');
    const b = makeItem('review');

    // The session decided both; the next poll no longer returns either row
    // (they are resolved server-side) and returns one NEW pending row instead.
    const fresh = makeItem('review');
    const projection = project([fresh], { resolved: [a.id, b.id] });

    // Old behaviour: sessionTotal = all.length = 1, decidedCount = 2 → "2 / 1".
    expect(projection.sessionTotal).toBe(3);
    expect(projection.sessionTotal).toBeGreaterThanOrEqual(2);
  });

  it('totals decided + still pending', () => {
    const done = makeItem('idea');
    const left = [makeItem('idea'), makeItem('review')];
    expect(project([done, ...left], { resolved: [done.id] }).sessionTotal).toBe(3);
  });
});

describe('projectQueue — filter chips count what is actually left', () => {
  it('excludes resolved and stood-down items from allCounts', () => {
    const decided = makeItem('review');
    const pending = makeItem('review');
    const worn = makeItem('idea');
    const skips = withSkip(withSkip(NO_SKIPS, worn.id), worn.id);

    const { allCounts } = project([decided, pending, worn], {
      resolved: [decided.id],
      skips,
    });

    expect(allCounts.review).toBe(1);
    expect(allCounts.idea).toBe(0);
    expect(allCounts.total).toBe(1);
  });

  it('counts kinds the reviewer filtered OFF — a chip must still say how much is waiting', () => {
    const items = [makeItem('review'), makeItem('idea'), makeItem('idea')];
    const { allCounts, items: dealt } = project(items, { kinds: new Set(['review']) });

    expect(dealt).toHaveLength(1);
    expect(allCounts.idea).toBe(2);
  });
});
