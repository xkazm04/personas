/** Watch, Unwatch and Refresh are user presses: their failures must reach the user. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  browseCatalog: vi.fn(async () => []),
  listSubscriptions: vi.fn(async () => []),
  changeActivity: vi.fn(async () => []),
  subscribeFeed: vi.fn(),
  unsubscribeFeed: vi.fn(),
  refreshCatalog: vi.fn(),
}));
vi.mock('@/api/events/sharedEvents', () => api);

import { useSharedEvents } from '../useSharedEvents';
import { useToastStore } from '@/stores/toastStore';

const appError = { error: 'Feed catalog is unreachable', kind: 'NetworkOffline' };

describe('useSharedEvents failures', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it.each([
    ['subscribe', () => api.subscribeFeed.mockRejectedValueOnce(appError), (h: ReturnType<typeof useSharedEvents>) => h.subscribe('c1')],
    ['unsubscribe', () => api.unsubscribeFeed.mockRejectedValueOnce(appError), (h: ReturnType<typeof useSharedEvents>) => h.unsubscribe('s1')],
    ['refresh', () => api.refreshCatalog.mockRejectedValueOnce(appError), (h: ReturnType<typeof useSharedEvents>) => h.refresh()],
  ])('%s failure shows an error toast with the reason', async (_name, arm, run) => {
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    arm();
    await act(async () => {
      await run(result.current);
    });
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('Feed catalog is unreachable');
  });
});

/**
 * The read on open was logged and forgotten, so a failure looked like an empty
 * catalog and like nothing being watched. `loadError` holds the raw rejection.
 */
describe('useSharedEvents loadError', () => {
  const subsError = { error: 'Subscriptions table is locked', kind: 'Database' };

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    api.browseCatalog.mockReset().mockResolvedValue([]);
    api.listSubscriptions.mockReset().mockResolvedValue([]);
    api.changeActivity.mockReset().mockResolvedValue([]);
    api.refreshCatalog.mockReset().mockResolvedValue(undefined);
  });

  it('is null after a successful read', async () => {
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {});
    expect(result.current.loadError).toBeNull();
  });

  it('holds the raw rejection of a failed catalog read', async () => {
    api.browseCatalog.mockRejectedValue(appError);
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loadError).toEqual(appError));
    expect(result.current.loading).toBe(false);
    expect(result.current.catalog).toEqual([]);
  });

  it('holds the raw rejection of a failed subscriptions read when the catalog loaded', async () => {
    api.listSubscriptions.mockRejectedValue(subsError);
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loadError).toEqual(subsError));
    expect(result.current.loading).toBe(false);
  });

  it('prefers the catalog rejection when both reads fail', async () => {
    api.browseCatalog.mockRejectedValue(appError);
    api.listSubscriptions.mockRejectedValue(subsError);
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {});
    expect(result.current.loadError).toEqual(appError);
  });

  it('does not count a failed activity read: only the last-change cells are affected', async () => {
    api.changeActivity.mockRejectedValue(subsError);
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {});
    expect(result.current.loadError).toBeNull();
  });

  it('a later successful read clears it', async () => {
    api.browseCatalog.mockRejectedValueOnce(appError);
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loadError).toEqual(appError));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.loadError).toBeNull());
  });

  it('a failed Refresh press stays a toast and sets no loadError', async () => {
    const { result } = renderHook(() => useSharedEvents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.refreshCatalog.mockRejectedValueOnce(appError);
    await act(async () => {
      await result.current.refresh();
    });
    expect(useToastStore.getState().toasts.at(-1)?.type).toBe('error');
    expect(result.current.loadError).toBeNull();
  });
});
