import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCompanionStore } from '../companionStore';
import type { PendingDecision } from '../decision/types';

/**
 * Slice 4 — `0 = explain + recommend, then re-ask`.
 *
 * Picking `0` (explain) must NOT clear the decision: it flips
 * `decisionExplained` so the bubble (OrbDecisionBubble) re-renders with the
 * recommendation above the still-present options. Only picking a real option
 * (1..n) resolves it. These tests pin that state contract — the bubble's render
 * path consumes exactly this state.
 */

function makeDecision(): PendingDecision {
  return {
    id: 'dec_explain',
    prompt: 'Shall I resolve this critical incident?',
    options: [
      { key: 'resolve', label: 'Resolve', run: vi.fn() },
      { key: 'dismiss', label: 'Dismiss', run: vi.fn(), danger: true },
    ],
    recommendation: 'I recommend resolving — it is blocking two executions.',
    detail: 'Severity is critical and it has been open 30 minutes.',
    source: 'incident',
    sourceRef: 'inc_99',
  };
}

describe('decision explain then re-ask flow (slice 4)', () => {
  beforeEach(() => {
    useCompanionStore.getState().clearPendingDecision();
  });

  it('picking 0 (explain) keeps the decision and its options intact', () => {
    const g = useCompanionStore.getState();
    g.setPendingDecision(makeDecision());
    g.markDecisionExplained();
    const s = useCompanionStore.getState();
    // Still pending — NOT cleared.
    expect(s.pendingDecision?.id).toBe('dec_explain');
    expect(s.pendingDecision?.options).toHaveLength(2);
    // The recommendation the bubble now reveals is available.
    expect(s.decisionExplained).toBe(true);
    expect(s.pendingDecision?.recommendation).toContain('recommend');
  });

  it('after explaining, picking a real option resolves (clears) the decision', () => {
    const g = useCompanionStore.getState();
    const decision = makeDecision();
    g.setPendingDecision(decision);
    g.markDecisionExplained();
    expect(useCompanionStore.getState().decisionExplained).toBe(true);

    // Simulate the bubble's pick handler: run the option, then clear.
    decision.options[0]!.run();
    g.clearPendingDecision();

    const s = useCompanionStore.getState();
    expect(decision.options[0]!.run).toHaveBeenCalledTimes(1);
    expect(s.pendingDecision).toBeNull();
    expect(s.decisionExplained).toBe(false);
  });

  it('explaining is idempotent — repeating 0 stays explained, still pending', () => {
    const g = useCompanionStore.getState();
    g.setPendingDecision(makeDecision());
    g.markDecisionExplained();
    g.markDecisionExplained();
    const s = useCompanionStore.getState();
    expect(s.decisionExplained).toBe(true);
    expect(s.pendingDecision?.id).toBe('dec_explain');
  });
});
