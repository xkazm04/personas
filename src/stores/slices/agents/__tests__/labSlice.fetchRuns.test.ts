import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression pin for the stale-async defect in `createLabCrud.fetchRuns`
 * (labSlice.ts): the write to `arenaRuns` (and its ab/matrix/eval siblings)
 * had no check that the fetch was still the newest one in flight. Switching
 * the selected persona twice in quick succession could let the FIRST
 * persona's slower response resolve after the SECOND's, showing the wrong
 * persona's run history. Fixed via `createLatestWins()`.
 */
vi.mock('@/api/agents/lab', () => ({
  labListArenaRuns: vi.fn(),
  labGetArenaResults: vi.fn(),
  labDeleteArenaRun: vi.fn(),
  labCancelArena: vi.fn(),
  labListAbRuns: vi.fn(),
  labGetAbResults: vi.fn(),
  labDeleteAbRun: vi.fn(),
  labCancelAb: vi.fn(),
  labListMatrixRuns: vi.fn(),
  labGetMatrixResults: vi.fn(),
  labDeleteMatrixRun: vi.fn(),
  labCancelMatrix: vi.fn(),
  labListEvalRuns: vi.fn(),
  labGetEvalResults: vi.fn(),
  labDeleteEvalRun: vi.fn(),
  labCancelEval: vi.fn(),
}));

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: (fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setExtra: vi.fn() }),
}));

import * as labApi from '@/api/agents/lab';
import { createLabSlice, type LabSlice } from '../labSlice';

const listArenaRunsMock = vi.mocked(labApi.labListArenaRuns);

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Minimal zustand-shaped harness around the slice creator. */
function harness() {
  let state = {} as LabSlice & Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createLabSlice as any)(set, get, {}) };
  return { get: () => state, set };
}

describe('labSlice fetchArenaRuns — stale-response guard', () => {
  beforeEach(() => {
    listArenaRunsMock.mockReset();
  });

  it('discards an older fetch that resolves after a newer one', async () => {
    const h = harness();

    const first = deferred<ReturnType<typeof labApi.labListArenaRuns> extends Promise<infer R> ? R : never>();
    const second = deferred<ReturnType<typeof labApi.labListArenaRuns> extends Promise<infer R> ? R : never>();
    listArenaRunsMock.mockReturnValueOnce(first.promise as never);
    listArenaRunsMock.mockReturnValueOnce(second.promise as never);

    // personaA's fetch starts first (slow)...
    const p1 = h.get().fetchArenaRuns('persona-a');
    // ...then personaB's fetch starts (fast) and resolves before personaA's.
    const p2 = h.get().fetchArenaRuns('persona-b');

    second.resolve([{ id: 'run-b' } as never]);
    await p2;
    expect(h.get().arenaRuns).toEqual([{ id: 'run-b' }]);

    // The stale personaA response finally resolves — must NOT overwrite state.
    first.resolve([{ id: 'run-a' } as never]);
    await p1;
    expect(h.get().arenaRuns).toEqual([{ id: 'run-b' }]);
  });
});
