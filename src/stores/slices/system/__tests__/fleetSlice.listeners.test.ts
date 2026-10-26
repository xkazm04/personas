// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { listen, typedListen } = vi.hoisted(() => ({ listen: vi.fn(), typedListen: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@/lib/eventRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/eventRegistry')>()),
  typedListen,
}));
vi.mock('@/api/fleet/fleet', () => ({
  listSessions: vi.fn(),
  setAutoHibernate: vi.fn().mockResolvedValue(undefined),
  setStateCutoffs: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/api/fleet/queue', () => ({ fleetQueueSnapshot: vi.fn() }));

import { createFleetSlice, type FleetSlice } from '../fleetSlice';

const FLAG_KEY = '__personasFleetSessionListeners';

function slice(): FleetSlice {
  let state = {} as FleetSlice;
  const set = (p: unknown) => {
    state = { ...state, ...(typeof p === 'function' ? (p as (s: FleetSlice) => object)(state) : (p as object)) };
  };
  state = createFleetSlice(set as never, (() => state) as never, {} as never);
  return state;
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, unknown>)[FLAG_KEY];
});

/**
 * The listeners are attached once per process behind a latch that was claimed
 * before any listen() resolved and never released. One rejected listen()
 * (bridge not ready at boot) left the latch set with that channel unattached,
 * so every later surface's "start listeners" was a no-op for the session and
 * the store stopped tracking fleet sessions live.
 */
describe('fleetStartSessionListeners — a failed attach can be retried', () => {
  it('releases the latch when an attach fails, and a later call re-attaches', async () => {
    const unlistens: Array<ReturnType<typeof vi.fn>> = [];
    const ok = () => { const u = vi.fn(); unlistens.push(u); return Promise.resolve(u); };
    listen
      .mockImplementationOnce(ok)
      .mockImplementationOnce(() => Promise.reject(new Error('event bridge not ready')))
      .mockImplementation(ok);
    typedListen.mockImplementation(ok);
    const s = slice();

    s.fleetStartSessionListeners();
    await settle();
    // The channels that did attach are detached again, so a retry cannot double them.
    expect(unlistens.slice(0, 2).every((u) => u.mock.calls.length === 1)).toBe(true);

    s.fleetStartSessionListeners();
    await settle();
    expect(listen).toHaveBeenCalledTimes(6);
    expect(typedListen).toHaveBeenCalledTimes(2);
  });

  it('stays a no-op after a fully successful attach', async () => {
    listen.mockResolvedValue(vi.fn());
    typedListen.mockResolvedValue(vi.fn());
    const s = slice();

    s.fleetStartSessionListeners();
    await settle();
    s.fleetStartSessionListeners();
    await settle();

    expect(listen).toHaveBeenCalledTimes(3);
    expect(typedListen).toHaveBeenCalledTimes(1);
  });
});
