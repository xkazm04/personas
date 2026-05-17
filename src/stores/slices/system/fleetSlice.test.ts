/**
 * Unit tests for the Fleet slice.
 *
 * Covers:
 *  - fleetRefresh — pull-based snapshot wiring (success + failure paths)
 *  - fleetPatchSession — in-place updates from event handlers
 *  - fleetRemoveSessionLocal — remove + active-session unfocus side effect
 *  - fleetApplyHookStatus — bridges FleetHookStatus into slice's flat fields
 *
 * Slice is a thin client cache; the Rust registry is the source of truth.
 * These tests don't assert what the Rust side does — only that the slice's
 * client-side reducers behave deterministically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the API surface so we can drive success/failure per call.
vi.mock('@/api/fleet/fleet', () => ({
  listSessions: vi.fn(),
  installHooks: vi.fn(),
  uninstallHooks: vi.fn(),
  checkHooks: vi.fn(),
  spawnSession: vi.fn(),
  writeInput: vi.fn(),
  resizeSession: vi.fn(),
  killSession: vi.fn(),
  removeSession: vi.fn(),
}));

import * as fleetApi from '@/api/fleet/fleet';
import { createFleetSlice, type FleetSlice } from './fleetSlice';
import type { SystemStore } from '../../storeTypes';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetRegistrySnapshot } from '@/lib/bindings/FleetRegistrySnapshot';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

function makeSession(partial: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 'session-1',
    claudeSessionId: null,
    cwd: 'C:\\path\\to\\project',
    projectLabel: 'project',
    name: null,
    args: [],
    state: 'spawning',
    lastActivityMs: BigInt(1_000_000),
    createdAtMs: BigInt(1_000_000),
    childPid: 1234,
    exitCode: null,
    stateReason: 'PTY spawned',
    ...partial,
  };
}

function makeSnapshot(sessions: FleetSession[] = [], hookPort = 17400, hooksInstalled = false): FleetRegistrySnapshot {
  return { sessions, hookPort, hooksInstalled };
}

/** Minimal Zustand-style harness — mirrors networkSlice.test.ts pattern. */
function makeHarness() {
  let state = {} as SystemStore;
  const set = (
    partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>),
  ) => {
    const patch =
      typeof partial === 'function'
        ? (partial as (s: SystemStore) => Partial<SystemStore>)(state)
        : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createFleetSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice };
  return { get: () => state, slice: () => state as unknown as FleetSlice };
}

describe('fleetSlice', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.listSessions).mockReset();
  });

  describe('initial state', () => {
    it('starts empty', () => {
      const h = makeHarness();
      const s = h.slice();
      expect(s.fleetSessions).toEqual([]);
      expect(s.fleetHookPort).toBe(0);
      expect(s.fleetHooksInstalled).toBe(false);
      expect(s.fleetSessionsLoading).toBe(false);
      expect(s.fleetActiveSessionId).toBeNull();
    });
  });

  describe('fleetRefresh', () => {
    it('populates sessions + hookPort + hooksInstalled from the snapshot', async () => {
      const h = makeHarness();
      const sess = [makeSession({ id: 'a', state: 'running' }), makeSession({ id: 'b', state: 'idle' })];
      vi.mocked(fleetApi.listSessions).mockResolvedValueOnce(makeSnapshot(sess, 17401, true));

      await h.slice().fleetRefresh();

      expect(h.get().fleetSessions.map((s) => s.id)).toEqual(['a', 'b']);
      expect(h.get().fleetHookPort).toBe(17401);
      expect(h.get().fleetHooksInstalled).toBe(true);
      expect(h.get().fleetSessionsLoading).toBe(false);
    });

    it('flips loading=true during the call and back to false on success', async () => {
      const h = makeHarness();
      let resolveFn: (v: FleetRegistrySnapshot) => void = () => {};
      const pending = new Promise<FleetRegistrySnapshot>((r) => (resolveFn = r));
      vi.mocked(fleetApi.listSessions).mockReturnValueOnce(pending);

      const inFlight = h.slice().fleetRefresh();
      expect(h.get().fleetSessionsLoading).toBe(true);
      resolveFn(makeSnapshot([], 17400, false));
      await inFlight;
      expect(h.get().fleetSessionsLoading).toBe(false);
    });

    it('clears loading and reports error when listSessions rejects', async () => {
      const h = makeHarness();
      vi.mocked(fleetApi.listSessions).mockRejectedValueOnce(new Error('boom'));

      await h.slice().fleetRefresh();

      expect(h.get().fleetSessionsLoading).toBe(false);
      // The slice routes errors through reportError → sliceErrors map.
      // We don't dig into the exact key; just assert that the previous
      // empty session list is preserved (no clobber on failure).
      expect(h.get().fleetSessions).toEqual([]);
    });
  });

  describe('fleetPatchSession', () => {
    it('updates one session by id and leaves others alone', async () => {
      const h = makeHarness();
      vi.mocked(fleetApi.listSessions).mockResolvedValueOnce(
        makeSnapshot([makeSession({ id: 'a' }), makeSession({ id: 'b', state: 'running' })]),
      );
      await h.slice().fleetRefresh();

      h.slice().fleetPatchSession('a', { state: 'awaiting_input', stateReason: 'Notification' });

      const updated = h.get().fleetSessions.find((s) => s.id === 'a');
      const untouched = h.get().fleetSessions.find((s) => s.id === 'b');
      expect(updated?.state).toBe('awaiting_input');
      expect(updated?.stateReason).toBe('Notification');
      expect(untouched?.state).toBe('running');
    });

    it('is a no-op for ids that do not exist', async () => {
      const h = makeHarness();
      vi.mocked(fleetApi.listSessions).mockResolvedValueOnce(makeSnapshot([makeSession({ id: 'a' })]));
      await h.slice().fleetRefresh();

      h.slice().fleetPatchSession('ghost', { state: 'exited' });

      expect(h.get().fleetSessions).toHaveLength(1);
      expect(h.get().fleetSessions[0]!.state).toBe('spawning');
    });
  });

  describe('fleetRemoveSessionLocal', () => {
    it('drops the session and clears activeSessionId when it matches', async () => {
      const h = makeHarness();
      vi.mocked(fleetApi.listSessions).mockResolvedValueOnce(
        makeSnapshot([makeSession({ id: 'a' }), makeSession({ id: 'b' })]),
      );
      await h.slice().fleetRefresh();
      h.slice().fleetSetActiveSession('a');

      h.slice().fleetRemoveSessionLocal('a');

      expect(h.get().fleetSessions.map((s) => s.id)).toEqual(['b']);
      expect(h.get().fleetActiveSessionId).toBeNull();
    });

    it('preserves activeSessionId when removing a different session', async () => {
      const h = makeHarness();
      vi.mocked(fleetApi.listSessions).mockResolvedValueOnce(
        makeSnapshot([makeSession({ id: 'a' }), makeSession({ id: 'b' })]),
      );
      await h.slice().fleetRefresh();
      h.slice().fleetSetActiveSession('a');

      h.slice().fleetRemoveSessionLocal('b');

      expect(h.get().fleetSessions.map((s) => s.id)).toEqual(['a']);
      expect(h.get().fleetActiveSessionId).toBe('a');
    });
  });

  describe('fleetApplyHookStatus', () => {
    function makeStatus(o: Partial<FleetHookStatus> = {}): FleetHookStatus {
      return {
        installed: false,
        presentEvents: [],
        missingEvents: [],
        installedPort: null,
        portMatches: false,
        ...o,
      };
    }

    it('sets fleetHooksInstalled=true only when installed AND port matches', () => {
      const h = makeHarness();
      h.slice().fleetApplyHookStatus(makeStatus({ installed: true, portMatches: true, installedPort: 17400 }));
      expect(h.get().fleetHooksInstalled).toBe(true);
      expect(h.get().fleetHookPort).toBe(17400);
    });

    it('sets fleetHooksInstalled=false when installed but port mismatches', () => {
      const h = makeHarness();
      h.slice().fleetApplyHookStatus(makeStatus({ installed: true, portMatches: false, installedPort: 17999 }));
      expect(h.get().fleetHooksInstalled).toBe(false);
      // installedPort still wins over the stored hookPort — surfaces the
      // mismatch in UI so the banner can warn.
      expect(h.get().fleetHookPort).toBe(17999);
    });

    it('keeps the existing hookPort when installedPort is null', () => {
      const h = makeHarness();
      // Seed an existing port from a prior fleetRefresh
      vi.mocked(fleetApi.listSessions).mockResolvedValueOnce(makeSnapshot([], 17400, false));
      return h.slice().fleetRefresh().then(() => {
        h.slice().fleetApplyHookStatus(makeStatus({ installed: false, installedPort: null }));
        expect(h.get().fleetHookPort).toBe(17400);
      });
    });
  });
});
