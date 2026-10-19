import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/twin/twin', () => ({
  listProfiles: vi.fn(),
  setActiveProfile: vi.fn(),
}));

import * as twinApi from '@/api/twin/twin';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import { createTwinSlice, type TwinSlice } from '../twinSlice';

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
  return { get: () => state };
}

beforeEach(() => { vi.clearAllMocks(); });

const profile = (id: string, active: boolean): TwinProfile =>
  ({ id, name: id, is_active: active }) as Partial<TwinProfile> as TwinProfile;

/**
 * setActiveTwin writes the new active twin, then forces a roster re-read. A
 * forced read that joined a mount-time read already in flight got the roster
 * as it was BEFORE the switch, and wrote the old twin back as active.
 */
describe('twinSlice — a forced roster read never joins an older one', () => {
  it('setActiveTwin lands on the picked twin even with a roster read in flight', async () => {
    const stale = deferred<TwinProfile[]>();
    const switched = deferred<never>();
    vi.mocked(twinApi.listProfiles)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([profile('A', false), profile('B', true)]);
    vi.mocked(twinApi.setActiveProfile).mockReturnValueOnce(switched.promise);
    const h = harness();

    const mountRead = h.get().fetchTwinProfiles({ force: true });
    const pick = h.get().setActiveTwin('B');
    await vi.waitFor(() => expect(twinApi.setActiveProfile).toHaveBeenCalledWith('B'));
    switched.resolve(undefined as never);
    // Let the switch reach its forced roster read while the mount read is open.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // The mount read was issued before the switch: it still sees A active.
    stale.resolve([profile('A', true), profile('B', false)]);
    await mountRead;
    await pick;

    expect(twinApi.listProfiles).toHaveBeenCalledTimes(2);
    expect(h.get().activeTwinId).toBe('B');
  });
});
