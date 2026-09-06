import { describe, it, expect } from 'vitest';
import { buildResultFromSignals } from './healthCheckSlice';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import type { Persona } from '@/lib/bindings/Persona';

const persona = { id: 'p1', name: 'Test' } as unknown as Persona;

function signal(over: Partial<PersonaHealthSignal> = {}): PersonaHealthSignal {
  return {
    personaId: 'p1',
    rollbackCount: 0,
    budgetRatio: 0,
    projectedExhaustionDays: null,
    healingFrequency: 0,
    failureTrend: 'stable',
    successRate: 100,
    successRateSource: 'executions',
    totalExecutions: 10,
    recentExecutions: 5,
    predictedFailureInDays: null,
    avgLatencyMs: 100,
    ...over,
  } as unknown as PersonaHealthSignal;
}

describe('buildResultFromSignals — budget', () => {
  it('charges an exhausted budget once, not twice', () => {
    // projectedExhaustionDays === 0 is defined as `max_budget - spend <= 0`
    // (personaHealthSlice.ts:441-445), i.e. exactly budgetRatio >= 1. Emitting
    // both signal_over_budget and signal_budget_exhausted charged 2 x 25 for
    // one fact, dropping an agent that merely hit its cap to score 50.
    const result = buildResultFromSignals(persona, signal({ budgetRatio: 1.2, projectedExhaustionDays: 0 }), []);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
  });

  it('still reports an over-budget agent whose burn rate gives no exhaustion date', () => {
    const result = buildResultFromSignals(persona, signal({ budgetRatio: 1.4, projectedExhaustionDays: null }), []);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(1);
  });

  it('leaves an under-budget agent unflagged', () => {
    const result = buildResultFromSignals(persona, signal({ budgetRatio: 0.5 }), []);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('still warns near the cap', () => {
    const result = buildResultFromSignals(persona, signal({ budgetRatio: 0.9 }), []);
    expect(result.issues.filter((i) => i.severity === 'warning')).toHaveLength(1);
  });
});
