import { describe, expect, it } from 'vitest';

import {
  estimateDispatch,
  formatEstimateCost,
  formatEstimateMinutes,
} from '../dockEstimate';

// The dock's readout is the capability the redesign was chosen for, and it is
// the one number on the console that is not a fact. These tests pin the two
// properties that keep it honest: the ORDERING is real (a pricier model or a
// higher effort always reads higher, so the gauge never misleads about a
// tradeoff the operator is making), and the ASSUMPTION is declared (an unset
// model is flagged, so the tooltip can say the rate was assumed rather than
// chosen). The absolute magnitude is deliberately NOT pinned — it is a
// heuristic, and a test asserting it to the cent would be a test of the guess.

const OBJECTIVE = 'Fix the ORT cache machine-type swap on ARM';

describe('estimateDispatch', () => {
  it('prices opus above sonnet above haiku for the same work', () => {
    const haiku = estimateDispatch(OBJECTIVE, 'haiku', 'high', false).cost;
    const sonnet = estimateDispatch(OBJECTIVE, 'sonnet', 'high', false).cost;
    const opus = estimateDispatch(OBJECTIVE, 'opus', 'high', false).cost;

    expect(haiku).toBeLessThan(sonnet);
    expect(sonnet).toBeLessThan(opus);
  });

  it('prices and times higher effort above lower effort, monotonically', () => {
    const efforts = ['low', 'medium', 'high', 'xhigh'] as const;
    const costs = efforts.map((e) => estimateDispatch(OBJECTIVE, 'opus', e, false).cost);
    const minutes = efforts.map((e) => estimateDispatch(OBJECTIVE, 'opus', e, false).minutes);

    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it('flags an unset model as assumed, and a chosen one as not', () => {
    expect(estimateDispatch(OBJECTIVE, null, 'high', false).assumedModel).toBe(true);
    expect(estimateDispatch(OBJECTIVE, 'opus', 'high', false).assumedModel).toBe(false);
  });

  it('treats a model it has no rate for as assumed rather than free', () => {
    // A preset could be added to MODEL_PRESETS before this table learns its
    // price. That must degrade to the default rate and SAY so — never to $0.
    const unknown = estimateDispatch(OBJECTIVE, 'some-future-model', 'high', false);
    const unset = estimateDispatch(OBJECTIVE, null, 'high', false);

    expect(unknown.assumedModel).toBe(true);
    expect(unknown.cost).toBe(unset.cost);
    expect(unknown.cost).toBeGreaterThan(0);
  });

  it('charges a longer objective and a loaded skill more than a bare one', () => {
    const bare = estimateDispatch('ship it', 'opus', 'high', false).cost;
    const longer = estimateDispatch(OBJECTIVE.repeat(12), 'opus', 'high', false).cost;
    const withSkill = estimateDispatch('ship it', 'opus', 'high', true).cost;

    expect(longer).toBeGreaterThan(bare);
    expect(withSkill).toBeGreaterThan(bare);
  });

  it('costs something even with an empty objective — the session still reads the repo', () => {
    expect(estimateDispatch('', 'opus', 'xhigh', false).cost).toBeGreaterThan(0);
  });
});

describe('formatEstimateCost', () => {
  // Delegates to the shared `formatCost`, so this pins the delegation (a
  // currency-shaped string carrying the amount) rather than re-asserting that
  // module's rounding contract, which is its own tests' job.
  it('renders a currency amount, symbol included', () => {
    expect(formatEstimateCost(4.2)).toContain('4.20');
    expect(formatEstimateCost(4.2)).toMatch(/[$]/);
  });

  it('renders an exact zero as zero, not as a sub-threshold claim', () => {
    expect(formatEstimateCost(0)).not.toContain('<');
  });
});

describe('formatEstimateMinutes', () => {
  it('never rounds a real wait down to zero — no estimate is instant', () => {
    expect(formatEstimateMinutes(0.2)).toBe('1m');
  });

  it('switches to hours past sixty minutes', () => {
    expect(formatEstimateMinutes(45)).toBe('45m');
    expect(formatEstimateMinutes(84)).toBe('1h 24m');
  });
});
