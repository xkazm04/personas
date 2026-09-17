/**
 * The Smee relay's live counters.
 *
 * `engine/smee_relay.rs` serializes `SmeeRelayStatus` with
 * `#[serde(rename_all = "camelCase")]`, and the hook used to redeclare a
 * snake_case interface of its own. Nothing type-checked the two against each
 * other, so the counters read `undefined` forever and the tab's
 * `eventsRelayed > 0` refetch gate never fired. What this pins is that the
 * hook's declared names are the names on the wire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import type { SmeeRelayStatusPayload } from '@/lib/eventRegistry';
import { useSmeeRelayStatus } from '../useSmeeRelayStatus';

const listenMock = vi.mocked(listen);

let channel: string | null = null;
let nativeHandler: EventCallback<SmeeRelayStatusPayload> | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSmeeRelayStatus', () => {
  beforeEach(() => {
    channel = null;
    nativeHandler = null;
    vi.stubGlobal('requestAnimationFrame', undefined);
    listenMock.mockImplementation(async (name: string, cb: unknown) => {
      channel = name;
      nativeHandler = cb as EventCallback<SmeeRelayStatusPayload>;
      return () => {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    listenMock.mockReset();
  });

  it('subscribes to the channel smee_relay emits on', async () => {
    renderHook(() => useSmeeRelayStatus());
    await flush();
    expect(channel).toBe('smee-relay-status');
  });

  it('reads the camelCase payload the backend actually serializes', async () => {
    const { result } = renderHook(() => useSmeeRelayStatus());
    await flush();

    const payload: SmeeRelayStatusPayload = {
      connected: true,
      eventsRelayed: 7,
      lastEventAt: '2026-09-17T10:00:00Z',
      error: undefined,
    };
    act(() => {
      nativeHandler?.({ event: 'smee-relay-status', id: 1, payload });
    });
    await flush();

    expect(result.current.connected).toBe(true);
    expect(result.current.eventsRelayed).toBe(7);
    expect(result.current.lastEventAt).toBe('2026-09-17T10:00:00Z');
    // The tab keys its relay-list refetch on this being above zero.
    expect(result.current.eventsRelayed > 0).toBe(true);
  });

  it('starts at a zeroed status before the first event', async () => {
    const { result } = renderHook(() => useSmeeRelayStatus());
    await flush();
    expect(result.current).toEqual({
      connected: false,
      eventsRelayed: 0,
      lastEventAt: undefined,
      error: undefined,
    });
  });
});
