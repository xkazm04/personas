import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Regression pin for the stale-async defect in
 * `useCompanionAssignmentBridge`: the 300ms per-assignment debounce
 * coalesces SCHEDULING of fetchDetail calls but not in-flight fetches. Two
 * TEAM_ASSIGNMENT_PROGRESS events >300ms apart, with the first
 * `getTeamAssignmentDetail` still resolving, could race with no ordering
 * guard on `upsert` — regressing the Athena assignment card back to an
 * older doneSteps/status. Fixed via a per-assignment `createLatestWins()`
 * token.
 */
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return Promise.resolve(unlisten);
  }),
}));

vi.mock('@/api/pipeline/assignments', () => ({
  getTeamAssignmentDetail: vi.fn(),
}));

import * as assignmentsApi from '@/api/pipeline/assignments';
import { useCompanionAssignmentBridge } from '../useCompanionAssignmentBridge';
import { useCompanionStore } from '../companionStore';

const getDetailMock = vi.mocked(assignmentsApi.getTeamAssignmentDetail);

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function detail(doneSteps: number, totalSteps = 5) {
  return {
    assignment: {
      id: 'assign-1',
      teamId: 'team-1',
      title: 'Title',
      goal: 'Goal',
      status: 'running',
      source: 'athena',
    },
    steps: Array.from({ length: totalSteps }, (_, i) => ({
      status: i < doneSteps ? 'done' : 'pending',
    })),
  } as unknown as Awaited<ReturnType<typeof assignmentsApi.getTeamAssignmentDetail>>;
}

describe('useCompanionAssignmentBridge — stale-fetch guard', () => {
  beforeEach(() => {
    handlers.clear();
    getDetailMock.mockReset();
    useCompanionStore.setState({ athenaAssignments: [] });
  });

  it('discards an older in-flight fetch that resolves after a newer one', async () => {
    const slow = deferred<ReturnType<typeof detail>>();
    const fast = deferred<ReturnType<typeof detail>>();
    getDetailMock.mockReturnValueOnce(slow.promise as never);
    getDetailMock.mockReturnValueOnce(fast.promise as never);

    renderHook(() => useCompanionAssignmentBridge());

    await waitFor(() => expect(handlers.has('team-assignment-progress')).toBe(true));
    const emit = handlers.get('team-assignment-progress')!;

    // First progress event — debounce schedules fetchDetail #1.
    act(() => {
      emit({ payload: { assignment_id: 'assign-1', status: 'running', step_id: 's1' } });
    });
    // Real 300ms debounce window — let it elapse so fetch #1 (slow) fires.
    await new Promise((r) => setTimeout(r, 320));

    // A second progress event >300ms later — debounce schedules fetchDetail #2.
    act(() => {
      emit({ payload: { assignment_id: 'assign-1', status: 'running', step_id: 's2' } });
    });
    await new Promise((r) => setTimeout(r, 320));
    // fetch #2 (fast) is now in flight too — both #1 and #2 are outstanding.

    // Fast fetch resolves first, with the newer/higher doneSteps.
    await act(async () => {
      fast.resolve(detail(4));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useCompanionStore.getState().athenaAssignments[0]?.doneSteps).toBe(4);

    // The stale slow fetch (older, lower doneSteps) finally resolves — it
    // must NOT regress the card backwards.
    await act(async () => {
      slow.resolve(detail(1));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useCompanionStore.getState().athenaAssignments[0]?.doneSteps).toBe(4);
  });
});
