import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { PersonaEvent } from '@/lib/types/types';

// A rejected server search was logged and nothing else: the filtered table then
// said "no events match" for a query that never ran, or kept showing the rows
// of the PREVIOUS filter.

const ipcError = { error: 'database is locked', kind: 'Database' };

function row(id: string, status: string): PersonaEvent {
  return {
    id, project_id: 'p', event_type: 'x', source_type: 'engine', source_id: null,
    target_persona_id: null, payload: null, status, error_message: null,
    processed_at: null, created_at: '2026-10-18T10:00:00Z', use_case_id: null, retry_count: 0,
  } as PersonaEvent;
}

const searchEvents = vi.fn();
vi.mock('@/api/overview/events', () => ({
  searchEvents: (...a: unknown[]) => searchEvents(...a),
  listKnownEventTypes: () => Promise.resolve([]),
  getEventSkippedStats: () => Promise.resolve(null),
}));
vi.mock('@/api/overview/savedViews', () => ({
  listSavedViewsByType: () => Promise.resolve([]),
  createSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
}));
const storeState = {
  recentEvents: [] as PersonaEvent[],
  pendingEventCount: 0,
  fetchRecentEvents: () => Promise.resolve(),
  pushRecentEvents: () => {},
};
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

describe('useEventLog server-search failure', () => {
  it('holds the failure instead of an empty or stale result, and retry re-runs it', async () => {
    searchEvents
      .mockResolvedValueOnce({ events: [row('a', 'failed')], has_more: false })
      .mockRejectedValueOnce(ipcError)
      .mockResolvedValueOnce({ events: [row('b', 'skipped')], has_more: false });

    const { result } = renderHook(() => useEventLog());

    act(() => result.current.setStatusFilter('failed'));
    await waitFor(() => expect(result.current.filteredEvents.map((e) => e.id)).toEqual(['a']));

    act(() => result.current.setStatusFilter('skipped'));
    await waitFor(() => expect(result.current.searchError).not.toBeNull());
    // The failed query must not keep answering with the previous filter's rows.
    expect(result.current.filteredEvents).toEqual([]);
    expect(result.current.isSearching).toBe(false);

    await act(async () => { await result.current.retrySearch(); });
    expect(result.current.searchError).toBeNull();
    expect(result.current.filteredEvents.map((e) => e.id)).toEqual(['b']);
  });
});
