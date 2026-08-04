// The duality's boundaries, and the two things it must NEVER touch.
import { describe, expect, it } from 'vitest';

import { deriveCriteria } from '../shipCriteria';
import { deriveFootprint } from '../shipDerive';
import { deriveDuality, itemVerdict } from '../shipDuality';
import { shipVerdict } from '../shipModel';

import { T, TX, ctx, feature, goal, member, milestone } from './shipFixtures';

const auth = ctx('c-auth', 'auth', 'ok', 2);

describe('itemVerdict — the disagreement boundary', () => {
  it('reads unrated on BOTH automation sides when there is no rating', () => {
    expect(itemVerdict(true, null)).toBe('unrated');
    expect(itemVerdict(false, null)).toBe('unrated');
  });

  it('never treats a null rating as a zero (unrated !== a rating of 1)', () => {
    expect(itemVerdict(true, null)).not.toBe(itemVerdict(true, 1));
    expect(itemVerdict(true, 1)).toBe('disagree');
    expect(itemVerdict(true, null)).toBe('unrated');
  });

  // ready + low rating: the operator distrusts a green light.
  it('flips to disagree between 2 and 3 when the automation says ready', () => {
    expect(itemVerdict(true, 1)).toBe('disagree');
    expect(itemVerdict(true, 2)).toBe('disagree');
    expect(itemVerdict(true, 3)).toBe('agree');
    expect(itemVerdict(true, 4)).toBe('agree');
    expect(itemVerdict(true, 5)).toBe('agree');
  });

  // not ready + high rating: the operator vouches for a red one.
  it('flips to disagree between 3 and 4 when the automation says not ready', () => {
    expect(itemVerdict(false, 1)).toBe('agree');
    expect(itemVerdict(false, 2)).toBe('agree');
    expect(itemVerdict(false, 3)).toBe('agree');
    expect(itemVerdict(false, 4)).toBe('disagree');
    expect(itemVerdict(false, 5)).toBe('disagree');
  });

  it('keeps 3 neutral on both sides — the midpoint takes no side', () => {
    expect(itemVerdict(true, 3)).toBe('agree');
    expect(itemVerdict(false, 3)).toBe('agree');
  });
});

describe('deriveDuality', () => {
  it('counts rated / unrated / agree / disagree and names the conflicts', () => {
    const core = [
      member(feature('f1', 'login', [auth], true), 'core', false, { rating: 5 }),   // agree
      member(feature('f2', 'export', [auth], true), 'core', false, { rating: 1 }),  // disagree
      member(feature('f3', 'audit', [auth], false), 'core', false, { rating: 4 }),  // disagree
      member(feature('f4', 'search', [auth], false)),                               // unrated
    ];
    const d = deriveDuality(core);
    expect(d).toMatchObject({ rated: 3, unrated: 1, agree: 1, disagree: 2 });
    expect(d.conflicts.map((c) => c.name)).toEqual(['export', 'audit']);
  });

  it('reports an all-unrated cut as zero agreement AND zero disagreement', () => {
    const core = [member(feature('f1', 'login', [auth]))];
    expect(deriveDuality(core)).toMatchObject({ rated: 0, unrated: 1, agree: 0, disagree: 0, conflicts: [] });
  });

  it('folds an empty cut to zeroes', () => {
    expect(deriveDuality([])).toEqual({ rated: 0, unrated: 0, agree: 0, disagree: 0, conflicts: [] });
  });
});

// The load-bearing guarantee of this work package: the rating is a second
// opinion, not a gate. If either of these ever fails, the design was violated.
describe('ratings do not move the verdict or the progress', () => {
  const base = { row: milestone(), monitoringWired: true, llmWired: true, t: T, tx: TX };

  const criteriaFor = (rating: number | null) => {
    const core = [member(feature('f1', 'login', [auth]), 'core', false, { rating, description: 'note' })];
    return deriveCriteria({ ...base, core, boundGoals: [goal('g1', 'Ship v1')], footprint: deriveFootprint(core, [auth]) });
  };

  it('produces the IDENTICAL criteria set for every rating, unrated included', () => {
    const unrated = criteriaFor(null);
    for (const r of [1, 2, 3, 4, 5]) expect(criteriaFor(r)).toEqual(unrated);
  });

  it('leaves shipVerdict at go even when the operator rates the cut a 1', () => {
    expect(shipVerdict(criteriaFor(null))).toBe('go');
    expect(shipVerdict(criteriaFor(1))).toBe('go');
    expect(deriveDuality([member(feature('f1', 'login', [auth]), 'core', false, { rating: 1 })]).disagree).toBe(1);
  });

  it('leaves shipVerdict blocking even when the operator rates the cut a 5', () => {
    const crit = ctx('c-crit', 'sync', 'crit', 1, 40);
    const core = [member(feature('f1', 'login', [crit], false), 'core', false, { rating: 5 })];
    const criteria = deriveCriteria({ ...base, core, boundGoals: [goal('g1', 'A')], footprint: deriveFootprint(core, [crit]) });
    expect(shipVerdict(criteria)).toBe('nogo');
  });

  it('keeps progress a pure automation ratio (the planner formula, restated)', () => {
    const progress = (core: ReturnType<typeof member>[]) =>
      Math.round((core.filter((m) => m.feature.ready).length / core.length) * 100);
    const ready = feature('f1', 'login', [auth], true);
    const notReady = feature('f2', 'export', [auth], false);
    expect(progress([member(ready, 'core', false, { rating: 1 }), member(notReady, 'core', false, { rating: 5 })])).toBe(50);
    expect(progress([member(ready), member(notReady)])).toBe(50);
  });
});
