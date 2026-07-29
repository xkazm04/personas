import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression pin for the stale-async defect in `twinSlice.fetchTwinTones`:
 * the write to `twinTones` had no check that the fetch was still the newest
 * one in flight. Rapid twin selection (twin A then twin B) could let A's
 * slower response resolve after B's, showing the wrong twin's tone profiles
 * in the Training Atelier. Fixed via `createLatestWins()`.
 */
vi.mock('@/api/twin/twin', () => ({
  listTones: vi.fn(),
}));

import * as twinApi from '@/api/twin/twin';
import { createTwinSlice, type TwinSlice } from '../twinSlice';

const listTonesMock = vi.mocked(twinApi.listTones);

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Minimal zustand-shaped harness around the slice creator. */
function harness() {
  let state = {} as TwinSlice & Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createTwinSlice as any)(set, get, {}) };
  return { get: () => state, set };
}

describe('twinSlice fetchTwinTones — stale-response guard', () => {
  beforeEach(() => {
    listTonesMock.mockReset();
  });

  it('discards an older twin fetch that resolves after a newer twin fetch', async () => {
    const h = harness();

    const first = deferred<Awaited<ReturnType<typeof twinApi.listTones>>>();
    const second = deferred<Awaited<ReturnType<typeof twinApi.listTones>>>();
    listTonesMock.mockReturnValueOnce(first.promise as never);
    listTonesMock.mockReturnValueOnce(second.promise as never);

    // Twin A's fetch starts first (slow)...
    const p1 = h.get().fetchTwinTones('twin-a');
    // ...then twin B's fetch starts (fast) and resolves before twin A's.
    const p2 = h.get().fetchTwinTones('twin-b');

    second.resolve([{ id: 'tone-b', twin_id: 'twin-b' } as never]);
    await p2;
    expect(h.get().twinTones).toEqual([{ id: 'tone-b', twin_id: 'twin-b' }]);

    // The stale twin-A response finally resolves — must NOT overwrite state.
    first.resolve([{ id: 'tone-a', twin_id: 'twin-a' } as never]);
    await p1;
    expect(h.get().twinTones).toEqual([{ id: 'tone-b', twin_id: 'twin-b' }]);
  });
});
