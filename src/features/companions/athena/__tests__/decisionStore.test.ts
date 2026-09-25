import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAthenaStore } from '../athenaStore';
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

describe('athenaStore decision actions', () => {
  beforeEach(() => {
    useAthenaStore.getState().clearPendingDecision();
  });

  it('starts with no pending decision and not explained', () => {
    const s = useAthenaStore.getState();
    expect(s.pendingDecision).toBeNull();
    expect(s.decisionExplained).toBe(false);
  });

  it('setPendingDecision stores the decision and resets explained', () => {
    const g = useAthenaStore.getState();
    g.markDecisionExplained(); // no-op while nothing pending
    g.setPendingDecision(makeDecision());
    const s = useAthenaStore.getState();
    expect(s.pendingDecision?.id).toBe('dec_1');
    expect(s.pendingDecision?.options).toHaveLength(2);
    expect(s.decisionExplained).toBe(false);
  });

  it('markDecisionExplained flips the flag but keeps the decision', () => {
    const g = useAthenaStore.getState();
    g.setPendingDecision(makeDecision());
    g.markDecisionExplained();
    const s = useAthenaStore.getState();
    expect(s.decisionExplained).toBe(true);
    expect(s.pendingDecision?.id).toBe('dec_1');
  });

  it('markDecisionExplained is a no-op when nothing is pending', () => {
    const g = useAthenaStore.getState();
    g.markDecisionExplained();
    expect(useAthenaStore.getState().decisionExplained).toBe(false);
    expect(useAthenaStore.getState().pendingDecision).toBeNull();
  });

  it('clearPendingDecision clears both the decision and explained flag', () => {
    const g = useAthenaStore.getState();
    g.setPendingDecision(makeDecision());
    g.markDecisionExplained();
    g.clearPendingDecision();
    const s = useAthenaStore.getState();
    expect(s.pendingDecision).toBeNull();
    expect(s.decisionExplained).toBe(false);
  });

  it('setPendingDecision after an explained decision resets explained', () => {
    const g = useAthenaStore.getState();
    g.setPendingDecision(makeDecision({ id: 'dec_a' }));
    g.markDecisionExplained();
    expect(useAthenaStore.getState().decisionExplained).toBe(true);
    g.setPendingDecision(makeDecision({ id: 'dec_b' }));
    const s = useAthenaStore.getState();
    expect(s.pendingDecision?.id).toBe('dec_b');
    expect(s.decisionExplained).toBe(false);
  });
});

// A failed decision used to be reported by a toast — a third communication
// dimension outside both the orb and the chat window. It is now reported by
// `decisionError`, which both decision surfaces render IN PLACE.
describe('runDecisionOption failure reporting', () => {
  beforeEach(() => {
    useAthenaStore.getState().clearPendingDecision();
  });

  it('keeps the decision pending and sets decisionError, raising no toast', async () => {
    const { runDecisionOption } = await import('../decision/resolveDecision');
    const { useToastStore } = await import('@/stores/toastStore');
    const addToast = vi.spyOn(useToastStore.getState(), 'addToast');

    useAthenaStore.getState().setPendingDecision(makeDecision());
    await runDecisionOption({
      key: 'resolve',
      label: 'Resolve',
      run: () => Promise.reject(new Error('boom')),
    });

    const s = useAthenaStore.getState();
    expect(s.pendingDecision?.id).toBe('dec_1'); // still answerable — retry in place
    expect(s.decisionError).toBe('run-failed');
    expect(addToast).not.toHaveBeenCalled();
    addToast.mockRestore();
  });

  it('a retry clears the previous failure before running', async () => {
    const { runDecisionOption } = await import('../decision/resolveDecision');
    useAthenaStore.getState().setPendingDecision(makeDecision());
    useAthenaStore.getState().setDecisionError('run-failed');

    await runDecisionOption({ key: 'resolve', label: 'Resolve', run: () => {} });
    const s = useAthenaStore.getState();
    expect(s.pendingDecision).toBeNull(); // resolved
    expect(s.decisionError).toBeNull();
  });
});

// --------------------------------------------------------------------------
// sweep #261 — the depth the bubble needs to say what is behind the question
// it is asking.
// --------------------------------------------------------------------------

describe('athenaStore decision queue depth', () => {
  beforeEach(() => {
    useAthenaStore.getState().setDecisionQueueDepth(0);
  });

  it('starts at zero', () => {
    expect(useAthenaStore.getState().decisionQueueDepth).toBe(0);
  });

  it('records what the last queue build found', () => {
    useAthenaStore.getState().setDecisionQueueDepth(12);
    expect(useAthenaStore.getState().decisionQueueDepth).toBe(12);
  });

  it('never goes negative, whatever the caller computed', () => {
    useAthenaStore.getState().setDecisionQueueDepth(-3);
    expect(useAthenaStore.getState().decisionQueueDepth).toBe(0);
  });

  it('survives clearPendingDecision - the backlog does not disappear with the bubble', () => {
    useAthenaStore.getState().setDecisionQueueDepth(4);
    useAthenaStore.getState().clearPendingDecision();
    expect(useAthenaStore.getState().decisionQueueDepth).toBe(4);
  });
});
