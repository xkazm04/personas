import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

// A failed read of the Activity ledger used to fall through to the
// "No executions yet" + Create persona onboarding state: the store had no
// per-request error, so a failure looked exactly like an empty install.

const feedState = { error: null as string | null };
const noop = () => {};
vi.mock('../useGlobalExecutionFeed', () => ({
  FILTER_ORDER: ['all'],
  useGlobalExecutionFeed: () => ({
    rows: [], total: 0, statusCounts: { all: 0 }, hasMore: false, warning: null, error: feedState.error,
    personas: [{ id: 'p1' }], personaModelById: new Map(), models: [],
    filter: 'all', setFilter: noop, modelFilter: 'all', setModelFilter: noop, selectedPersonaId: null,
    isFetching: false, isRefreshing: false, refresh: () => Promise.resolve(), loadMore: noop,
    selectedExec: null, setSelectedExec: noop, openExecution: noop,
  }),
}));
vi.mock('../useGlobalExecutionColumns', () => ({ useGlobalExecutionColumns: () => [] }));
vi.mock('@/features/overview/components/dashboard/OverviewFilterContext', () => ({
  useOverviewFilterActions: () => ({ setSelectedPersonaId: noop }),
}));

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import GlobalExecutionList from '../GlobalExecutionList';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

describe('GlobalExecutionList failed read', () => {
  it('a failed read shows the failure, not the onboarding state', () => {
    feedState.error = 'Database error: database is locked';
    render(<GlobalExecutionList />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No executions yet')).toBeNull();
  });

  it('a clean empty read still shows the onboarding state', () => {
    feedState.error = null;
    render(<GlobalExecutionList />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('No executions yet')).toBeTruthy();
  });
});
