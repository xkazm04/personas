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
