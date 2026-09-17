import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { usePolling } from '../usePolling';
import { __resetPollingCoordinatorForTests } from '@/lib/polling/pollingCoordinator';

/**
 * A Live dot needs three states, not one. Before this the hook returned
 * `isPolling = enabled && visible` and swallowed the failure, so a wedged
 * poller, a backgrounded tab and a healthy loop were the same observation -
 * which is why call sites grew their own `stale` flags.
 */
describe('usePolling observability', () => {
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    __resetPollingCoordinatorForTests();
  });

  afterEach(() => {
    __resetPollingCoordinatorForTests();
  });

  it('reports backoff with the error instead of a silent green light', async () => {
    const boom = new Error('fetch exploded');
    const fetchFn = vi.fn().mockRejectedValue(boom);

    const { result } = renderHook(() =>
      usePolling(fetchFn, { interval: 5_000, enabled: true, name: 'test:backoff' }),
    );

    await waitFor(() => {
      expect(result.current.lastError).toBe(boom);
    });
    expect(result.current.consecutiveErrors).toBe(1);
    expect(result.current.nextEligibleAt).toBeGreaterThan(Date.now());
    expect(result.current.pausedReason).toBe('backoff');
    expect(result.current.isPolling).toBe(false);
    // A failed cycle refreshed nothing, so the stamp must not advance.
    expect(result.current.lastRefreshed).toBeNull();
  });

  it('reports a hidden tab as hidden, not as a live poller', async () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePolling(fetchFn, { interval: 5_000, enabled: true, name: 'test:hidden' }),
    );

    await waitFor(() => {
      expect(result.current.lastRefreshed).not.toBeNull();
    });
    expect(result.current.pausedReason).toBeNull();
    expect(result.current.isPolling).toBe(true);

    await act(async () => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.pausedReason).toBe('hidden');
    expect(result.current.isPolling).toBe(false);
  });

  it('clears the error and stamps a refresh on the next success', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);

    const { result, rerender } = renderHook(() =>
      usePolling(fetchFn, { interval: 5_000, enabled: true, name: 'test:recovery' }),
    );

    await waitFor(() => {
      expect(result.current.consecutiveErrors).toBe(1);
    });

    expect(result.current.pausedReason).toBe('backoff');

    // The backoff gate is a timestamp, so recovery is the first tick after it
    // elapses. Move the clock past it rather than waiting out the real delay.
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 120_000);
    await act(async () => {
      const { getPollingCoordinator } = await import('@/lib/polling/pollingCoordinator');
      getPollingCoordinator().flush();
    });
    rerender();

    await waitFor(() => {
      expect(result.current.lastRefreshed).not.toBeNull();
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current.lastError).toBeNull();
    expect(result.current.consecutiveErrors).toBe(0);
    expect(result.current.nextEligibleAt).toBe(0);
    expect(result.current.pausedReason).toBeNull();
    nowSpy.mockRestore();
  });
});
