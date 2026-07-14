import { describe, it, expect } from 'vitest';

import {
  computeSensorStats,
  isNoisySensor,
  MIN_VERDICTS_FOR_CREDIBILITY,
} from '../sensorStats';
import type { DevIdea } from '@/lib/bindings/DevIdea';

function idea(over: Partial<DevIdea>): DevIdea {
  return {
    id: Math.random().toString(36),
    origin: 'llm_cost',
    status: 'accepted',
    verify_state: null,
    ...over,
  } as unknown as DevIdea;
}

describe('computeSensorStats', () => {
  it('ignores classic scanner ideas (they belong to the Agent Scoreboard)', () => {
    const stats = computeSensorStats([idea({ origin: null }), idea({ origin: 'llm_cost' })]);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.origin).toBe('llm_cost');
  });

  it('scores verify rate on cleared+moved over everything judged', () => {
    const stats = computeSensorStats([
      idea({ verify_state: 'cleared' }),
      idea({ verify_state: 'moved' }),
      idea({ verify_state: 'unchanged' }),
      idea({ verify_state: 'regressed' }),
      idea({ status: 'pending' }), // not judged — must not dilute the rate
    ]);
    const s = stats[0]!;
    expect(s.raised).toBe(5);
    expect(s.verdicted).toBe(4);
    expect(s.verifyRate).toBeCloseTo(0.5); // (1 cleared + 1 moved) / 4
  });

  it('reports an unjudged sensor as null, NOT 0% (unknown is not bad)', () => {
    const s = computeSensorStats([idea({ status: 'pending' })])[0]!;
    expect(s.verifyRate).toBeNull();
    expect(s.verdicted).toBe(0);
    expect(s.hasEnoughSignal).toBe(false);
  });

  it('only trusts a rate once enough findings have been judged', () => {
    const few = computeSensorStats(
      Array.from({ length: MIN_VERDICTS_FOR_CREDIBILITY - 1 }, () => idea({ verify_state: 'unchanged' })),
    )[0]!;
    expect(few.hasEnoughSignal).toBe(false);

    const enough = computeSensorStats(
      Array.from({ length: MIN_VERDICTS_FOR_CREDIBILITY }, () => idea({ verify_state: 'unchanged' })),
    )[0]!;
    expect(enough.hasEnoughSignal).toBe(true);
  });

  it('surfaces the worst credible sensor first — that is the one worth acting on', () => {
    const stats = computeSensorStats([
      // good sensor: 3 verdicts, all cleared
      ...Array.from({ length: 3 }, () => idea({ origin: 'sentry_spike', verify_state: 'cleared' })),
      // bad sensor: 3 verdicts, none moved
      ...Array.from({ length: 3 }, () => idea({ origin: 'llm_cost', verify_state: 'unchanged' })),
    ]);
    expect(stats[0]!.origin).toBe('llm_cost');
    expect(stats[0]!.verifyRate).toBe(0);
  });
});

describe('isNoisySensor — B2 credibility', () => {
  it('flags a sensor whose shipped findings never move the number', () => {
    const s = computeSensorStats(
      Array.from({ length: MIN_VERDICTS_FOR_CREDIBILITY }, () => idea({ verify_state: 'unchanged' })),
    )[0]!;
    expect(isNoisySensor(s)).toBe(true);
  });

  it('does NOT flag a sensor that simply has too little data yet', () => {
    const s = computeSensorStats([idea({ verify_state: 'unchanged' })])[0]!;
    expect(s.verifyRate).toBe(0);
    expect(isNoisySensor(s)).toBe(false); // low n — unproven, not condemned
  });

  it('does not flag an effective sensor', () => {
    const s = computeSensorStats(
      Array.from({ length: MIN_VERDICTS_FOR_CREDIBILITY }, () => idea({ verify_state: 'cleared' })),
    )[0]!;
    expect(isNoisySensor(s)).toBe(false);
  });
});
