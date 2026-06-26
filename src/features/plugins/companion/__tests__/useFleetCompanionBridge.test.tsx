/**
 * Unit tests for useFleetCompanionBridge.
 *
 * The bridge subscribes to three Fleet Tauri events and, for each one,
 * looks up the matching FleetSession in the systemStore and calls the
 * `companion_record_fleet_event` Tauri command with a normalized payload.
 * These tests exercise that mapping by:
 *
 *  1. Mocking `@tauri-apps/api/event.listen` to capture each handler
 *     registered by the hook.
 *  2. Mocking `@tauri-apps/api/tauriInvoke.invokeWithTimeout` (proxied through
 *     invokeWithTimeout) so we can assert the resulting command + args.
 *  3. Mocking the systemStore to surface a deterministic FleetSession.
 *
 * Pure unit-level: no Rust, no DB, no real Tauri runtime.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// Capture handlers keyed by event name as listen() is called.
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const unlisten = vi.fn();

// The bridge now drives the snapshot itself via the imperative store API
// (`useSystemStore.getState().fleetRefresh()`). Hoist a shared spy so both
// the store mock factory and the test assertions can reach the same fn.
const { fleetRefresh } = vi.hoisted(() => ({
  fleetRefresh: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return Promise.resolve(unlisten);
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock the wrapper module that the hook actually imports — not the
// raw `@tauri-apps/api/core` which a lint rule (rightly) forbids.
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn().mockResolvedValue('ep_abc123'),
}));

import * as tauriInvoke from '@/lib/tauriInvoke';
import type { FleetSession } from '@/lib/bindings/FleetSession';

// Stub the systemStore — only the read paths the hook uses.
const SAMPLE_SESSION: FleetSession = {
  id: 'session-uuid-aaa',
  claudeSessionId: 'cc-session-zzz',
  cwd: 'C:\\path\\to\\personas',
  projectLabel: 'personas',
  name: 'refactor',
  args: [],
  state: 'running',
  lastActivityMs: BigInt(1_000_000),
  createdAtMs: BigInt(1_000_000),
  childPid: 1234,
  exitCode: null,
  stateReason: null,
};

// Mirror the real zustand store: `useSystemStore` is a callable hook
// (reactive selector) that ALSO carries an imperative `getState()` returning
// the full state object. The bridge uses both — the selector for the live
// `fleetSessions` slice and `getState().fleetRefresh()` to pull a snapshot.
vi.mock('@/stores/systemStore', () => {
  // Build state lazily inside getState() so `SAMPLE_SESSION` is read at
  // call time (render/mount), not at factory time — static imports are
  // hoisted above the const, so an eager read would hit a TDZ.
  const getState = () => ({ fleetSessions: [SAMPLE_SESSION], fleetRefresh });
  const useSystemStore = Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(getState()),
    { getState },
  );
  return { useSystemStore };
});

import { useFleetCompanionBridge } from '../useFleetCompanionBridge';

const FLEET_STATE = 'fleet-session-state';
const FLEET_EXITED = 'fleet-session-exited';
const FLEET_REGISTRY = 'fleet-registry-changed';

describe('useFleetCompanionBridge', () => {
  beforeEach(() => {
    handlers.clear();
    vi.mocked(tauriInvoke.invokeWithTimeout).mockClear();
    fleetRefresh.mockClear();
    unlisten.mockClear();
  });

  it('registers listeners for the three FLEET_* events on mount', async () => {
    renderHook(() => useFleetCompanionBridge());
    // Listeners are registered async via Promise resolution; flush a microtask.
    await waitFor(() => {
      expect(handlers.has(FLEET_STATE)).toBe(true);
      expect(handlers.has(FLEET_EXITED)).toBe(true);
      expect(handlers.has(FLEET_REGISTRY)).toBe(true);
    });
  });

  it('pulls an initial fleet snapshot on mount', async () => {
    // The bridge is the only thing keeping `fleetSessions` current when the
    // Fleet page is unmounted, so it must seed the slice once on mount.
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(1));
  });

  it('routes FLEET_SESSION_STATE → companion_record_fleet_event { kind:"state_changed" }', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_STATE)).toBe(true));

    act(() => {
      handlers.get(FLEET_STATE)!({
        payload: {
          session_id: SAMPLE_SESSION.id,
          state: 'awaiting_input',
          reason: 'Notification: permission',
        },
      });
    });

    await waitFor(() => expect(tauriInvoke.invokeWithTimeout).toHaveBeenCalledTimes(1));
    const [cmd, args] = vi.mocked(tauriInvoke.invokeWithTimeout).mock.calls[0]!;
    expect(cmd).toBe('companion_record_fleet_event');
    expect((args as Record<string, unknown>).input).toMatchObject({
      sessionId: SAMPLE_SESSION.id,
      claudeSessionId: SAMPLE_SESSION.claudeSessionId,
      projectLabel: 'personas',
      cwd: SAMPLE_SESSION.cwd,
      kind: 'state_changed',
      state: 'awaiting_input',
      reason: 'Notification: permission',
    });
  });

  it('routes FLEET_SESSION_EXITED → companion_record_fleet_event { kind:"exited", exitCode }', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_EXITED)).toBe(true));

    act(() => {
      handlers.get(FLEET_EXITED)!({
        payload: { session_id: SAMPLE_SESSION.id, exit_code: 137 },
      });
    });

    await waitFor(() => expect(tauriInvoke.invokeWithTimeout).toHaveBeenCalledTimes(1));
    const [, args] = vi.mocked(tauriInvoke.invokeWithTimeout).mock.calls[0]!;
    expect((args as Record<string, unknown>).input).toMatchObject({
      sessionId: SAMPLE_SESSION.id,
      kind: 'exited',
      exitCode: 137,
    });
  });

  it('schedules a snapshot refresh (records nothing) for a session not yet in the cache', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_STATE)).toBe(true));
    // mount already pulled one snapshot; isolate the event-driven refresh.
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(1));

    act(() => {
      handlers.get(FLEET_STATE)!({
        payload: { session_id: 'ghost-id', state: 'running' },
      });
    });

    // New behavior: instead of silently dropping the event, the bridge
    // schedules a coalesced (150ms) refresh so the store can catch up and the
    // next event for this session resolves. No episode is recorded yet.
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(tauriInvoke.invokeWithTimeout).not.toHaveBeenCalled();
  });

  it('FLEET_REGISTRY_CHANGED kind:"added" refreshes the slice and records once', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_REGISTRY)).toBe(true));
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(1)); // mount

    act(() => {
      handlers.get(FLEET_REGISTRY)!({
        payload: { kind: 'added', session_id: SAMPLE_SESSION.id },
      });
    });

    // New behavior: "added" (a non-"removed" kind) also schedules a coalesced
    // refresh so the slice carries the new row.
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(2), { timeout: 1000 });

    // The added path is additionally debounced ~250ms so the slice
    // has time to populate session metadata before the episode is recorded.
    await waitFor(
      () => expect(tauriInvoke.invokeWithTimeout).toHaveBeenCalledTimes(1),
      { timeout: 1000 },
    );
    const [cmd, args] = vi.mocked(tauriInvoke.invokeWithTimeout).mock.calls[0]!;
    expect(cmd).toBe('companion_record_fleet_event');
    expect((args as Record<string, unknown>).input).toMatchObject({
      sessionId: SAMPLE_SESSION.id,
      kind: 'spawned',
      athenaOwned: false,
    });
  });

  it('FLEET_REGISTRY_CHANGED kind:"updated" refreshes the slice but records nothing', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_REGISTRY)).toBe(true));
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(1)); // mount

    act(() => {
      handlers.get(FLEET_REGISTRY)!({
        payload: { kind: 'updated', session_id: SAMPLE_SESSION.id },
      });
    });

    // "updated" is non-"removed" → schedules a refresh, but never records an
    // episode (only "added" records a spawn).
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(2), { timeout: 1000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(tauriInvoke.invokeWithTimeout).not.toHaveBeenCalled();
  });

  it('FLEET_REGISTRY_CHANGED kind:"removed" neither refreshes nor records', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_REGISTRY)).toBe(true));
    await waitFor(() => expect(fleetRefresh).toHaveBeenCalledTimes(1)); // mount

    act(() => {
      handlers.get(FLEET_REGISTRY)!({
        payload: { kind: 'removed', session_id: SAMPLE_SESSION.id },
      });
    });

    // "removed" is the one kind that must NOT pull a snapshot (the row is gone)
    // and never records. Wait past the 150ms debounce window to be sure no
    // additional refresh beyond the mount one was scheduled.
    await new Promise((r) => setTimeout(r, 250));
    expect(fleetRefresh).toHaveBeenCalledTimes(1);
    expect(tauriInvoke.invokeWithTimeout).not.toHaveBeenCalled();
  });
});
