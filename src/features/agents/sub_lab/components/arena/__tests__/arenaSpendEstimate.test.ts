/**
 * Begin the Match dispatched immediately, so a 4-model x 12-use-case sweep
 * was an unbounded bill. These cases pin what the preflight must say.
 */
import { describe, it, expect } from 'vitest';
import {
  estimateArenaSpend,
  pricePerDuel,
  formatEstimatedCost,
  EstimatedCost,
  ESTIMATED_INPUT_TOKENS_PER_DUEL,
  ESTIMATED_OUTPUT_TOKENS_PER_DUEL,
  type ArenaContender,
} from '../arenaSpendEstimate';
import { ANTHROPIC_TIERS } from '@/features/agents/sub_model_config/libs/compareHelpers';
import { formatCost } from '@/lib/utils/formatters';

// Contenders come from the catalogue that owns the tier vocabulary, so a tier
// rename cannot leave this suite asserting against a model the app dropped.
const tier = (value: string): ArenaContender => {
  const found = ANTHROPIC_TIERS.find((tt) => tt.value === value);
  if (!found) throw new Error(`no such tier: ${value}`);
  return { id: found.value, label: found.label };
};
const haiku = tier('haiku');
const sonnet = tier('sonnet');
const opus = tier('opus');
const ollama: ArenaContender = { id: 'ollama:llama3', label: 'Llama 3 (local)' };

describe('pricePerDuel', () => {
  it('prices a tier from the one published rate table', () => {
    // Sonnet is $3/MTok in, $15/MTok out.
    const expected =
      (ESTIMATED_INPUT_TOKENS_PER_DUEL / 1e6) * 3 + (ESTIMATED_OUTPUT_TOKENS_PER_DUEL / 1e6) * 15;
    expect(pricePerDuel('sonnet')).toBeCloseTo(expected, 10);
  });

  it('returns null - not zero - for a model with no published price', () => {
    expect(pricePerDuel('ollama:llama3')).toBeNull();
  });
});

describe('estimateArenaSpend', () => {
  it('names the duel count as contenders x scenarios', () => {
    expect(estimateArenaSpend([haiku, sonnet, opus], 10).duelCount).toBe(30);
  });

  it('sums the priced contenders', () => {
    const one = estimateArenaSpend([sonnet], 1).cost.toUsd();
    expect(estimateArenaSpend([sonnet], 10).cost.toUsd()).toBeCloseTo(one * 10, 10);
    expect(estimateArenaSpend([haiku, sonnet], 1).cost.toUsd()).toBeCloseTo(
      (pricePerDuel('haiku') ?? 0) + (pricePerDuel('sonnet') ?? 0),
      10,
    );
  });

  it('names an unpriced contender instead of coercing it to $0', () => {
    const e = estimateArenaSpend([sonnet, ollama], 4);
    expect(e.duelCount).toBe(8);
    expect(e.pricedDuels).toBe(4);
    expect(e.unpricedDuels).toBe(4);
    expect(e.unpricedLabels).toEqual(['Llama 3 (local)']);
    // The unpriced half contributes nothing to the figure AND is reported.
    expect(e.cost.toUsd()).toBeCloseTo((pricePerDuel('sonnet') ?? 0) * 4, 10);
  });

  it('treats an all-unpriced roster as unpriced, not free', () => {
    const e = estimateArenaSpend([ollama], 3);
    expect(e.cost.toUsd()).toBe(0);
    expect(e.unpricedDuels).toBe(3);
    expect(e.pricedDuels).toBe(0);
  });

  it('floors the scenario count at one so an empty catalog still counts a duel', () => {
    expect(estimateArenaSpend([sonnet], 0).duelCount).toBe(1);
  });
});

describe('formatEstimatedCost', () => {
  it('does not round a real sub-cent cost down to zero', () => {
    expect(formatEstimatedCost(EstimatedCost.fromUsd(0.004))).toBe('<$0.01');
    expect(formatEstimatedCost(EstimatedCost.fromUsd(0))).toBe('$0.00');
    expect(formatEstimatedCost(EstimatedCost.fromUsd(1.5))).toBe('$1.50');
  });

  it("routes through the app's one money door rather than toFixed", () => {
    // Same contract as formatCost at precision 2 - the arena does not get its
    // own opinion about what a dollar looks like.
    expect(formatEstimatedCost(EstimatedCost.fromUsd(12.345))).toBe(
      formatCost(12.345, { precision: 2 }),
    );
  });
});
