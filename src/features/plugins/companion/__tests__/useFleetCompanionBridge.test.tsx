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

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ fleetSessions: [SAMPLE_SESSION] }),
}));

import { useFleetCompanionBridge } from '../useFleetCompanionBridge';

const FLEET_STATE = 'fleet-session-state';
const FLEET_EXITED = 'fleet-session-exited';
const FLEET_REGISTRY = 'fleet-registry-changed';

describe('useFleetCompanionBridge', () => {
  beforeEach(() => {
    handlers.clear();
    vi.mocked(tauriInvoke.invokeWithTimeout).mockClear();
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

  it('ignores events for sessions not in the slice cache (race protection)', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_STATE)).toBe(true));

    act(() => {
      handlers.get(FLEET_STATE)!({
        payload: { session_id: 'ghost-id', state: 'running' },
      });
    });

    // Stronger than "expect not called" — flush microtasks and confirm.
    await new Promise((r) => setTimeout(r, 50));
    expect(tauriInvoke.invokeWithTimeout).not.toHaveBeenCalled();
  });

  it('FLEET_REGISTRY_CHANGED kind:"added" debounces and records once', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_REGISTRY)).toBe(true));

    act(() => {
      handlers.get(FLEET_REGISTRY)!({
        payload: { kind: 'added', session_id: SAMPLE_SESSION.id },
      });
    });

    // The added path is intentionally debounced ~250ms so the slice
    // has time to populate session metadata.
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

  it('ignores FLEET_REGISTRY_CHANGED for "updated" / "removed"', async () => {
    renderHook(() => useFleetCompanionBridge());
    await waitFor(() => expect(handlers.has(FLEET_REGISTRY)).toBe(true));

    act(() => {
      handlers.get(FLEET_REGISTRY)!({
        payload: { kind: 'updated', session_id: SAMPLE_SESSION.id },
      });
      handlers.get(FLEET_REGISTRY)!({
        payload: { kind: 'removed', session_id: SAMPLE_SESSION.id },
      });
    });

    // No invoke even after the debounce window.
    await new Promise((r) => setTimeout(r, 400));
    expect(tauriInvoke.invokeWithTimeout).not.toHaveBeenCalled();
  });
});
