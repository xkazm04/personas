/**
 * The late-tick guard on the cloud health poll.
 *
 * The monitor is a 30s `setTimeout` chain. When the laptop sleeps, the first
 * tick after wake fires minutes late and lands before the network is back up,
 * so the poll throws and the hook stamped `isReconnecting: true` (and, twenty
 * attempts later, `cloudError`) for a connection that was never gone. A tick
 * that arrives far past its scheduled time is evidence about the HOST, not the
 * peer; on its own it may not declare the orchestrator dead.
 *
 * These tests pin the discriminator: a late tick whose probe fails re-probes
 * once after a short grace and stays connected when the re-probe answers; a
 * late tick whose re-probe ALSO fails still enters the reconnect loop (the
 * guard must not hide a real outage); an on-time failure is untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const cloudGetConfig = vi.hoisted(() => vi.fn());
const cloudReconnectFromKeyring = vi.hoisted(() => vi.fn().mockResolvedValue(12));
vi.mock('@/api/system/cloud', () => ({ cloudGetConfig, cloudReconnectFromKeyring }));

import { useSystemStore } from '@/stores/systemStore';
import { useCloudHealthMonitor } from '../useCloudHealthMonitor';

const HEALTH_POLL_INTERVAL = 30_000;
const SLEEP = 10 * 60_000;
const REPROBE_GRACE = 3_000;
const T0 = new Date('2026-09-03T08:00:00Z').getTime();

const connectedConfig = { is_connected: true } as never;
const idle = { isReconnecting: false, attempt: 0, nextRetryAt: null };

function mountConnected() {
  useSystemStore.setState({ cloudConfig: connectedConfig, cloudReconnectState: idle, cloudError: null });
  return renderHook(() => useCloudHealthMonitor());
}

/** Simulate a suspend: the wall clock jumps by `by` before the pending timer fires. */
async function fireTickAfterSleep(by: number) {
  vi.setSystemTime(T0 + by);
  await act(() => vi.advanceTimersByTimeAsync(HEALTH_POLL_INTERVAL));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  cloudGetConfig.mockReset();
  cloudReconnectFromKeyring.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  useSystemStore.setState({ cloudConfig: null, cloudReconnectState: idle, cloudError: null });
});

describe('useCloudHealthMonitor late tick after host sleep', () => {
  it('stays connected when a late tick fails once and the re-probe answers', async () => {
    cloudGetConfig.mockRejectedValueOnce(new Error('network unreachable')).mockResolvedValue(connectedConfig);
    const { unmount } = mountConnected();

    await fireTickAfterSleep(SLEEP);

    // The first failure after a suspend is suspect: no reconnect loop yet.
    expect(useSystemStore.getState().cloudReconnectState.isReconnecting).toBe(false);
    expect(useSystemStore.getState().cloudError).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(REPROBE_GRACE));

    expect(cloudGetConfig).toHaveBeenCalledTimes(2);
    expect(useSystemStore.getState().cloudReconnectState.isReconnecting).toBe(false);
    expect(useSystemStore.getState().cloudError).toBeNull();
    expect(cloudReconnectFromKeyring).not.toHaveBeenCalled();
    unmount();
  });

  it('still enters the reconnect loop when the re-probe after a late tick also fails', async () => {
    cloudGetConfig.mockRejectedValue(new Error('network unreachable'));
    const { unmount } = mountConnected();

    await fireTickAfterSleep(SLEEP);
    await act(() => vi.advanceTimersByTimeAsync(REPROBE_GRACE));

    expect(cloudGetConfig).toHaveBeenCalledTimes(2);
    expect(useSystemStore.getState().cloudReconnectState.isReconnecting).toBe(true);
    unmount();
  });

  it('enters the reconnect loop at once when an on-time tick fails', async () => {
    cloudGetConfig.mockRejectedValue(new Error('orchestrator down'));
    const { unmount } = mountConnected();

    await fireTickAfterSleep(0);

    expect(cloudGetConfig).toHaveBeenCalledTimes(1);
    expect(useSystemStore.getState().cloudReconnectState.isReconnecting).toBe(true);
    unmount();
  });
});
