/**
 * A needs-you re-login is ONE quick decision on the orb, never a toast.
 * Driven through the real queue builder (`buildDecisionQueueForTest`) so what is
 * asserted is the list the bubble receives.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildDecisionQueueForTest } from '../useDecisionQueue';
import { resetDecisionDeferrals } from '../decisionDeferral';
import { buildSimAccountsSnapshot } from '@/features/fleet/monitor/grid/simulation/simPlans';
import { useToastStore } from '@/stores/toastStore';

const NOW = 1_800_000_000_000;
const relogin = vi.hoisted(() => vi.fn(async () => ({})));
const list = vi.hoisted(() => vi.fn());

vi.mock('@/api/fleet/claudeAccounts', () => ({
  listClaudeAccounts: list,
  reloginClaudeAccount: relogin,
}));

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionListProactiveMessages: vi.fn(async () => []),
  };
});

/** The roster has nothing waiting: only the orb-only re-login source speaks. */
const NO_ROSTER = { items: [], decide: async () => undefined };

describe('the orb decision for a re-login that needs the operator', () => {
  beforeEach(() => {
    resetDecisionDeferrals();
    relogin.mockClear();
    list.mockReset();
    list.mockResolvedValue(buildSimAccountsSnapshot(NOW));
  });

  it('surfaces one decision per needs-you plan, in words, with Re-login and Dismiss', async () => {
    const queue = await buildDecisionQueueForTest(NO_ROSTER);
    expect(queue.map((d) => d.source)).toEqual(['claude_relogin', 'claude_relogin']);
    const first = queue[0]!;
    expect(first.prompt).toBe('fleet.five@simulated.test: Sign in by hand once');
    expect(first.options.map((o) => o.label)).toEqual(['Re-login', 'Dismiss']);
    expect(first.options[1]!.danger).toBe(true);
    expect(queue[1]!.prompt).toBe('fleet.seven@simulated.test: Proton wants its second factor');
  });

  it('a running or done re-login is not a decision', async () => {
    const queue = await buildDecisionQueueForTest(NO_ROSTER);
    expect(queue.some((d) => d.sourceRef === 'sim-plan-6' || d.sourceRef === 'sim-plan-2')).toBe(false);
  });

  it('Re-login runs the command for that account', async () => {
    const [first] = await buildDecisionQueueForTest(NO_ROSTER);
    await first!.options[0]!.run();
    expect(relogin).toHaveBeenCalledWith('sim-plan-5');
  });

  it('Dismiss holds the decision back for the session, and a later run is a new question', async () => {
    const [first] = await buildDecisionQueueForTest(NO_ROSTER);
    await first!.options[1]!.run();
    expect((await buildDecisionQueueForTest(NO_ROSTER)).map((d) => d.sourceRef)).toEqual(['sim-plan-7']);

    const next = buildSimAccountsSnapshot(NOW);
    next.accounts = next.accounts.map((a) =>
      a.id === 'sim-plan-5' && a.relogin ? { ...a, relogin: { ...a.relogin, startedAtMs: a.relogin.startedAtMs + 60_000 } } : a);
    list.mockResolvedValue(next);
    expect((await buildDecisionQueueForTest(NO_ROSTER)).map((d) => d.sourceRef)).toEqual(['sim-plan-5', 'sim-plan-7']);
  });

  it('never raises a toast', async () => {
    const add = vi.spyOn(useToastStore.getState(), 'addToast');
    await buildDecisionQueueForTest(NO_ROSTER);
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('a failing read leaves the rest of the queue intact', async () => {
    list.mockRejectedValue(new Error('offline'));
    await expect(buildDecisionQueueForTest(NO_ROSTER)).resolves.toEqual([]);
  });
});
