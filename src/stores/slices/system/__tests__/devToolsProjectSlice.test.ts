import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { DevGoal } from '@/lib/bindings/DevGoal';

// The slice reaches the backend only through `import * as devApi` — mocking the
// whole module keeps this a pure unit test of the slice's own bookkeeping and
// error contract.
vi.mock('@/api/devTools/devTools', () => ({
  resolveGoalAcceptance: vi.fn(),
  countPendingAcceptance: vi.fn(),
}));

vi.mock('@/api/devTools/kpis', () => ({}));

import * as devApi from '@/api/devTools/devTools';
import { createDevToolsProjectSlice, type DevToolsProjectSlice } from '../devToolsProjectSlice';

const resolveMock = vi.mocked(devApi.resolveGoalAcceptance);
const countMock = vi.mocked(devApi.countPendingAcceptance);

function goal(over: Partial<DevGoal> = {}): DevGoal {
  return {
    id: 'g1', project_id: 'p1', parent_goal_id: null, context_id: null, kpi_id: null,
    order_index: 0, title: 'Ship the acceptance gate', description: null,
    status: 'awaiting_acceptance', progress: 100, target_date: null,
    started_at: null, completed_at: null,
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
    ...over,
  };
}

/** Minimal zustand-shaped harness around the slice creator. */
function harness() {
  let state = {} as DevToolsProjectSlice & { error: unknown };
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createDevToolsProjectSlice as any)(set, get, {}), error: null };
  return { get: () => state, set };
}

describe('devToolsProjectSlice — goal acceptance verdicts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('accepts a pending goal and refreshes the badge count', async () => {
    resolveMock.mockResolvedValue(goal({ status: 'done' }));
    countMock.mockResolvedValue(0);
    const h = harness();
    h.set({ goals: [goal()], pendingAcceptanceCount: 1 });

    await h.get().acceptGoal('g1');

    expect(resolveMock).toHaveBeenCalledWith('g1', 'accept');
    expect(h.get().goals[0]!.status).toBe('done');
    expect(h.get().pendingAcceptanceCount).toBe(0);
  });

  it('REJECTS on a failed accept write instead of swallowing it', async () => {
    // The triage deck resolves a card the moment it decides. Without this
    // rejection the goal stays `awaiting_acceptance` in the DB while the card
    // leaves the queue — a swallowed failure is indistinguishable from a
    // completed decision and the card never comes back.
    const h = harness();
    resolveMock.mockRejectedValueOnce(new Error('database is locked'));

    await expect(h.get().acceptGoal('g1')).rejects.toThrow('database is locked');
  });

  it('REJECTS on a failed reject write instead of swallowing it', async () => {
    const h = harness();
    resolveMock.mockRejectedValueOnce(new Error('goal g1 is not awaiting acceptance'));

    await expect(h.get().rejectGoal('g1', 'needs rework')).rejects.toThrow(/not awaiting acceptance/);
    expect(resolveMock).toHaveBeenCalledWith('g1', 'reject', 'needs rework');
  });
});
