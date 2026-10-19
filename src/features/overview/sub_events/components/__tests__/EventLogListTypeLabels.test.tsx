import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PersonaEvent } from '@/lib/types/types';

// The Events tab spelled one event type three ways: the cell said
// "SLA breach opened" (eventTypeLabel), the type filter said
// "sla.breach.opened" (underscores swapped for spaces only) and the detail
// modal's title printed the raw id. All three now go through eventTypeLabel.

const event = {
  id: 'e1', project_id: 'p', event_type: 'sla.breach.opened', source_type: 'system', source_id: null,
  target_persona_id: null, payload: null, status: 'delivered', error_message: null,
  processed_at: null, created_at: '2026-10-18T10:00:00Z', use_case_id: null, retry_count: 0,
} as PersonaEvent;

const noop = () => {};
vi.mock('../../libs/useEventLog', () => ({
  useEventLog: () => ({
    recentEvents: [event], personas: [], availableTypes: ['sla.breach.opened'], skippedStats: null,
    statusFilter: 'all', setStatusFilter: noop, typeFilter: 'all', setTypeFilter: noop,
    selectedEvent: event, setSelectedEvent: noop,
    selectedPersonaId: null, setSelectedPersonaId: noop,
    isFetching: false, isRefreshing: false, isSearching: false, searchError: null, retrySearch: noop,
    filteredEvents: [event], handleRefresh: noop, getPersona: () => null,
    searchText: '', setSearchText: noop, serverHasMore: false,
    loadOlder: noop, hasMoreOlder: false, isLoadingOlder: false,
    savedViews: [], activeViewId: null, saveCurrentView: noop, applySavedView: noop, removeSavedView: noop, clearFilters: noop,
  }),
}));

let capturedTypeOptions: { value: string; label: string }[] = [];
vi.mock('../eventLogColumns', () => ({
  useEventLogColumns: (args: { typeOptions: { value: string; label: string }[] }) => {
    capturedTypeOptions = args.typeOptions;
    return [];
  },
}));

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import EventLogList from '../EventLogList';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

describe('EventLogList names an event type one way', () => {
  it('the detail modal title and the type filter use the translated label', () => {
    render(<EventLogList />);
    const title = document.getElementById('detail-modal-title');
    expect(title?.textContent).toContain('SLA breach opened');
    expect(title?.textContent).not.toContain('sla.breach.opened');
    expect(capturedTypeOptions.find((o) => o.value === 'sla.breach.opened')?.label).toBe('SLA breach opened');
    expect(screen.queryAllByText(/^sla\.breach\.opened$/)).toHaveLength(0);
  });
});
