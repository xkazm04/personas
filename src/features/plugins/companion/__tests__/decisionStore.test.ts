import { describe, it, expect, beforeEach } from 'vitest';
import { useCompanionStore } from '../companionStore';
import type { PendingDecision } from '../decision/types';

function makeDecision(overrides: Partial<PendingDecision> = {}): PendingDecision {
  return {
    id: 'dec_1',
    prompt: 'Shall I resolve this incident?',
    options: [
      { key: 'resolve', label: 'Resolve', run: () => {} },
      { key: 'dismiss', label: 'Dismiss', run: () => {}, danger: true },
    ],
    recommendation: 'I recommend resolving — severity is critical.',
    detail: 'The incident has blocked two executions for 30 minutes.',
    source: 'incident',
    sourceRef: 'inc_42',
    ...overrides,
  };
}

describe('companionStore decision actions', () => {
  beforeEach(() => {
    useCompanionStore.getState().clearPendingDecision();
  });

  it('starts with no pending decision and not explained', () => {
    const s = useCompanionStore.getState();
    expect(s.pendingDecision).toBeNull();
    expect(s.decisionExplained).toBe(false);
  });

  it('setPendingDecision stores the decision and resets explained', () => {
    const g = useCompanionStore.getState();
    g.markDecisionExplained(); // no-op while nothing pending
    g.setPendingDecision(makeDecision());
    const s = useCompanionStore.getState();
    expect(s.pendingDecision?.id).toBe('dec_1');
    expect(s.pendingDecision?.options).toHaveLength(2);
    expect(s.decisionExplained).toBe(false);
  });

  it('markDecisionExplained flips the flag but keeps the decision', () => {
    const g = useCompanionStore.getState();
    g.setPendingDecision(makeDecision());
    g.markDecisionExplained();
    const s = useCompanionStore.getState();
    expect(s.decisionExplained).toBe(true);
    expect(s.pendingDecision?.id).toBe('dec_1');
  });

  it('markDecisionExplained is a no-op when nothing is pending', () => {
    const g = useCompanionStore.getState();
    g.markDecisionExplained();
    expect(useCompanionStore.getState().decisionExplained).toBe(false);
    expect(useCompanionStore.getState().pendingDecision).toBeNull();
  });

  it('clearPendingDecision clears both the decision and explained flag', () => {
    const g = useCompanionStore.getState();
    g.setPendingDecision(makeDecision());
    g.markDecisionExplained();
    g.clearPendingDecision();
    const s = useCompanionStore.getState();
    expect(s.pendingDecision).toBeNull();
    expect(s.decisionExplained).toBe(false);
  });

  it('setPendingDecision after an explained decision resets explained', () => {
    const g = useCompanionStore.getState();
    g.setPendingDecision(makeDecision({ id: 'dec_a' }));
    g.markDecisionExplained();
    expect(useCompanionStore.getState().decisionExplained).toBe(true);
    g.setPendingDecision(makeDecision({ id: 'dec_b' }));
    const s = useCompanionStore.getState();
    expect(s.pendingDecision?.id).toBe('dec_b');
    expect(s.decisionExplained).toBe(false);
  });
});
