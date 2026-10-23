import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// A failed read of the live event window used to render the first-run
// "No events yet" + Create persona CTA: eventSlice.fetchRecentEvents only
// logged the failure, so the page could not tell it from an empty install.

const noop = () => {};
vi.mock('../../libs/useEventLog', () => ({
  useEventLog: () => ({
    recentEvents: [], personas: [], availableTypes: [], skippedStats: null,
    statusFilter: 'all', setStatusFilter: noop, typeFilter: 'all', setTypeFilter: noop,
    selectedEvent: null, setSelectedEvent: noop,
    selectedPersonaId: null, setSelectedPersonaId: noop,
    isFetching: false, isRefreshing: false, isSearching: false, searchError: null, retrySearch: noop,
    filteredEvents: [], handleRefresh: noop, getPersona: () => null,
    searchText: '', setSearchText: noop, serverHasMore: false,
    loadOlder: noop, hasMoreOlder: false, isLoadingOlder: false,
    savedViews: [], activeViewId: null, saveCurrentView: noop, applySavedView: noop, removeSavedView: noop, clearFilters: noop,
  }),
}));
vi.mock('../eventLogColumns', () => ({ useEventLogColumns: () => [] }));

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import EventLogList from '../EventLogList';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});
beforeEach(() => {
  useOverviewStore.setState({ recentEventsError: null });
});

describe('EventLogList failed read', () => {
  it('a failed read shows the failure, not the first-run CTA', () => {
    useOverviewStore.setState({ recentEventsError: 'Database error: database is locked' });
    render(<EventLogList />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No events yet')).toBeNull();
  });

  it('an empty clean read still shows the first-run state', () => {
    render(<EventLogList />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('No events yet')).toBeTruthy();
  });
});
