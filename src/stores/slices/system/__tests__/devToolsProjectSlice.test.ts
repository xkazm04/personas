import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { DevGoal } from '@/lib/bindings/DevGoal';

// The slice reaches the backend only through `import * as devApi` — mocking the
// whole module keeps this a pure unit test of the slice's own bookkeeping and
// error contract.
vi.mock('@/api/devTools/devTools', () => ({
  resolveGoalAcceptance: vi.fn(),
  countPendingAcceptance: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

// reportError emits its toast through the store bus; counting emits is how
// these tests tell a store toast from a caller's own toastCatch.
const busEmit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storeBus', () => ({ storeBus: { emit: busEmit } }));

vi.mock('@/api/devTools/kpis', () => ({}));

import * as devApi from '@/api/devTools/devTools';
import { createDevToolsProjectSlice, type DevToolsProjectSlice } from '../devToolsProjectSlice';

const resolveMock = vi.mocked(devApi.resolveGoalAcceptance);
const countMock = vi.mocked(devApi.countPendingAcceptance);
const updateGoalMock = vi.mocked(devApi.updateGoal);
const deleteGoalMock = vi.mocked(devApi.deleteGoal);

async function storeToasts(): Promise<number> {
  await vi.dynamicImportSettled();
  return busEmit.mock.calls.filter(([ev]) => ev === 'toast').length;
}

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

describe('devToolsProjectSlice — goal edits report failure to the editor', () => {
  // GoalEditorModal awaits updateGoal/deleteGoal and only closes on success;
  // its catch toasts a localized message. A store action that swallowed the
  // rejection closed the editor and dropped the typed edits on a failed save.
  beforeEach(() => { vi.clearAllMocks(); });

  it('REJECTS a failed goal update, keeps the goal, and leaves the toast to the caller', async () => {
    const h = harness();
    h.set({ goals: [goal({ status: 'open', title: 'Before' })] });
    updateGoalMock.mockRejectedValueOnce({ error: 'database is locked', kind: 'database' });

    await expect(h.get().updateGoal('g1', { title: 'After' })).rejects.toEqual(
      expect.objectContaining({ error: 'database is locked' }),
    );
    expect(h.get().goals[0]!.title).toBe('Before');
    expect(await storeToasts()).toBe(0);
  });

  it('REJECTS a failed goal delete and keeps the row', async () => {
    const h = harness();
    h.set({ goals: [goal({ status: 'open' })] });
    deleteGoalMock.mockRejectedValueOnce(new Error('goal is linked to a running task'));

    await expect(h.get().deleteGoal('g1')).rejects.toThrow(/linked to a running task/);
    expect(h.get().goals).toHaveLength(1);
    expect(await storeToasts()).toBe(0);
  });

  it('still applies a successful update', async () => {
    const h = harness();
    h.set({ goals: [goal({ status: 'open', title: 'Before' })] });
    updateGoalMock.mockResolvedValueOnce(goal({ status: 'open', title: 'After' }));

    await h.get().updateGoal('g1', { title: 'After' });
    expect(h.get().goals[0]!.title).toBe('After');
  });
});
