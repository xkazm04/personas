/**
 * The Fleet policy (auto-hibernate + state cutoffs) reaches the Rust ticker
 * once at boot and then only when the user changes it.
 *
 * Regression: `fleetRefresh` re-sent `fleet_set_auto_hibernate` and
 * `fleet_set_state_cutoffs` on EVERY call, and refresh fires from many
 * surfaces, so opening Overview sent each command 7 times.
 *
 * Mocks the IPC door itself (`invokeWithTimeout`) rather than the fleet API
 * module, so the assertion is on the command names that actually cross IPC.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { invokeWithTimeout } = vi.hoisted(() => ({
  invokeWithTimeout: vi.fn((cmd: string, _args?: Record<string, unknown>) =>
    Promise.resolve(
      cmd === 'fleet_list_sessions' ? { sessions: [], hookPort: 17400, hooksInstalled: false } : null,
    ),
  ),
}));
vi.mock('@/lib/tauriInvoke', () => ({ invokeWithTimeout }));

import { createFleetSlice, _resetFleetPolicyPushForTests, type FleetSlice } from './fleetSlice';
import type { SystemStore } from '../../storeTypes';

const HIBERNATE = 'fleet_set_auto_hibernate';
const CUTOFFS = 'fleet_set_state_cutoffs';

/** Minimal Zustand-style harness, same shape as fleetSlice.test.ts. */
function makeHarness(seed: Partial<FleetSlice> = {}) {
  let state = {} as SystemStore;
  const set = (partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createFleetSlice(set as never, get as never, {} as never);
  // `seed` plays the part of the persisted values rehydrated at boot.
  state = { ...state, ...slice, ...seed } as SystemStore;
  return { get: () => state as unknown as FleetSlice };
}

/** Settle every pending microtask (a rejected push releases its latch there). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const calls = (cmd: string) => invokeWithTimeout.mock.calls.filter(([c]) => c === cmd);

describe('fleet policy push', () => {
  beforeEach(() => {
    _resetFleetPolicyPushForTests();
    invokeWithTimeout.mockClear();
  });

  it('pushes the persisted policy once at boot, then never again on refresh', async () => {
    const h = makeHarness({
      fleetAutoHibernate: true,
      fleetAutoHibernateMinutes: 45,
      fleetStaleMinutes: 9,
      fleetFrozenMinutes: 3,
    });

    await h.get().fleetRefresh(); // the boot refresh
    expect(calls(HIBERNATE)).toHaveLength(1);
    expect(calls(CUTOFFS)).toHaveLength(1);
    expect(calls(HIBERNATE)[0]?.[1]).toEqual({ enabled: true, afterMinutes: 45 });
    expect(calls(CUTOFFS)[0]?.[1]).toEqual({ staleSecs: 540, stalledSecs: 180 });

    invokeWithTimeout.mockClear();
    for (let i = 0; i < 6; i += 1) await h.get().fleetRefresh();

    expect(calls('fleet_list_sessions')).toHaveLength(6);
    expect(calls(HIBERNATE)).toHaveLength(0);
    expect(calls(CUTOFFS)).toHaveLength(0);
  });

  it('concurrent boot refreshes push once', async () => {
    const h = makeHarness();
    await Promise.all([h.get().fleetRefresh(), h.get().fleetRefresh(), h.get().fleetRefresh()]);
    expect(calls(HIBERNATE)).toHaveLength(1);
    expect(calls(CUTOFFS)).toHaveLength(1);
  });

  it('a failed boot push is retried by the next refresh', async () => {
    const h = makeHarness();
    invokeWithTimeout.mockImplementationOnce(() => Promise.reject(new Error('backend not ready')));
    await h.get().fleetRefresh();
    await flush(); // let the rejection release the latch

    invokeWithTimeout.mockClear();
    await h.get().fleetRefresh();
    expect(calls(HIBERNATE)).toHaveLength(1);
    expect(calls(CUTOFFS)).toHaveLength(1);
  });

  it('a failed setter push is healed by the next refresh, once', async () => {
    const h = makeHarness();
    await h.get().fleetRefresh();
    invokeWithTimeout.mockClear();

    invokeWithTimeout.mockImplementationOnce(() => Promise.reject(new Error('ipc dropped')));
    h.get().fleetSetStaleMinutes(10);
    await flush();

    await h.get().fleetRefresh();
    // 1 failed setter call + 1 heal carrying the value the user chose.
    expect(calls(CUTOFFS)).toHaveLength(2);
    expect(calls(CUTOFFS)[1]?.[1]).toEqual({ staleSecs: 600, stalledSecs: 120 });
    expect(calls(HIBERNATE)).toHaveLength(1);

    await h.get().fleetRefresh(); // healed: the next refresh sends nothing
    expect(calls(CUTOFFS)).toHaveLength(2);
    expect(calls(HIBERNATE)).toHaveLength(1);
  });

  it('changing a setting pushes exactly once, with the new value', async () => {
    const h = makeHarness();
    await h.get().fleetRefresh();
    invokeWithTimeout.mockClear();

    h.get().fleetSetAutoHibernate(true);
    expect(calls(HIBERNATE)).toHaveLength(1);
    expect(calls(HIBERNATE)[0]?.[1]).toEqual({ enabled: true, afterMinutes: 30 });

    h.get().fleetSetAutoHibernateMinutes(12);
    expect(calls(HIBERNATE)).toHaveLength(2);
    expect(calls(HIBERNATE)[1]?.[1]).toEqual({ enabled: true, afterMinutes: 12 });

    h.get().fleetSetStaleMinutes(10);
    expect(calls(CUTOFFS)).toHaveLength(1);
    expect(calls(CUTOFFS)[0]?.[1]).toEqual({ staleSecs: 600, stalledSecs: 120 });

    h.get().fleetSetFrozenMinutes(4);
    expect(calls(CUTOFFS)).toHaveLength(2);
    expect(calls(CUTOFFS)[1]?.[1]).toEqual({ staleSecs: 600, stalledSecs: 240 });

    // And a refresh after the change still sends neither.
    await h.get().fleetRefresh();
    expect(calls(HIBERNATE)).toHaveLength(2);
    expect(calls(CUTOFFS)).toHaveLength(2);
  });
});
