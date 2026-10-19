import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// A failed saved-view save reached only the log, and the toolbar closed the
// name field as if the view existed.

const ipcError = { error: 'database is locked', kind: 'Database' };
const toastHandler = vi.fn();
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: () => toastHandler,
}));
vi.mock('@/api/overview/events', () => ({
  searchEvents: () => Promise.resolve({ events: [], has_more: false }),
  listKnownEventTypes: () => Promise.resolve([]),
  getEventSkippedStats: () => Promise.resolve(null),
}));
vi.mock('@/api/overview/savedViews', () => ({
  listSavedViewsByType: () => Promise.resolve([]),
  createSavedView: () => Promise.reject(ipcError),
  deleteSavedView: () => Promise.reject(ipcError),
}));
const storeState = { recentEvents: [], pendingEventCount: 0, fetchRecentEvents: () => Promise.resolve(), pushRecentEvents: () => {} };
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: unknown[] }) => unknown) => sel({ personas: [] }),
}));
vi.mock('@/hooks/realtime/useEventBusListener', () => ({ useEventBusListener: () => {} }));
vi.mock('@/features/overview/components/dashboard/OverviewFilterContext', () => ({
  useOverviewFilterValues: () => ({ selectedPersonaId: null }),
  useOverviewFilterActions: () => ({ setSelectedPersonaId: () => {} }),
}));

import { useEventLog } from '../useEventLog';

describe('useEventLog saved views', () => {
  it('a failed save resolves false and is reported, not just logged', async () => {
    const { result } = renderHook(() => useEventLog());
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveCurrentView('v'); });
    expect(saved).toBe(false);
    expect(toastHandler).toHaveBeenCalledWith(ipcError);
  });

  it('a failed delete is reported', async () => {
    toastHandler.mockClear();
    const { result } = renderHook(() => useEventLog());
    await act(async () => { await result.current.removeSavedView('v1'); });
    expect(toastHandler).toHaveBeenCalledWith(ipcError);
  });
});
