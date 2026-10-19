/**
 * The catalog filters run over the LOADED window: `list_recipes` is paged
 * (RECIPE_PAGE_SIZE rows at a time) and the browse list only ever sees what
 * has been fetched so far. A search whose match sits on a later page must keep
 * paging instead of declaring "no results" about rows it never looked at, and
 * the header must not present the loaded window as the size of the catalog.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Recipe } from '../../types';

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ selectedPersona: null }),
}));
vi.mock('@/stores/selectors/personaSelectors', () => ({
  useSelectedUseCases: () => EMPTY_USE_CASES,
}));
vi.mock('../../useEligibility', () => ({
  useRecipeEligibilityMap: () => EMPTY_MAP,
}));
// Filter synchronously so the test reads the settled list, not a timer.
vi.mock('@/hooks/utility/timing/useDebounce', () => ({
  useDebounce: <T,>(v: T) => v,
}));
vi.mock('../RecipesTableResults', () => ({
  RecipesTableResults: (p: { recipes: Recipe[]; isLoading?: boolean }) => (
    <div data-testid="table" data-loading={p.isLoading ? 'yes' : 'no'}>
      {p.recipes.map((r) => <span key={r.id}>{r.name}</span>)}
    </div>
  ),
}));
vi.mock('@/features/shared/components/feedback/ScenarioEmptyState', () => ({
  NoResults: () => <div data-testid="no-results" />,
}));

const EMPTY_USE_CASES: never[] = [];
const EMPTY_MAP = new Map();

import { RecipesBrowseList } from '../RecipesBrowseList';

const recipe = (i: number, name = `Recipe ${i}`): Recipe => ({
  id: `r-${i}`,
  slug: `r-${i}`,
  name,
  summary: '',
  description: '',
  category: 'automation',
  requiredConnectors: [],
  optionalConnectors: [],
  template: {
    title: name, description: '', capabilitySummary: '', category: 'automation',
    toolHints: [], notificationChannelTypes: [], promptTemplate: '',
  },
  bindings: [],
  isBuiltin: true,
  version: '1.0.0',
  publishedAt: '2026-01-01T00:00:00Z',
  author: 'Personas Team',
  tags: [],
});

const PAGE_1 = Array.from({ length: 3 }, (_, i) => recipe(i));
const PAGE_2 = [recipe(3, 'Invoice chaser')];

/** Stands in for RecipesPage: owns the loaded pages and the in-flight flag. */
function Harness({ fail = false, onRequest }: { fail?: boolean; onRequest: () => void }) {
  const [rows, setRows] = useState(PAGE_1);
  const [search, setSearch] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMore = rows.length < PAGE_1.length + PAGE_2.length;
  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    onRequest();
    setLoadingMore(true);
    void Promise.resolve().then(() => {
      if (!fail) setRows((r) => [...r, ...PAGE_2]);
      setLoadingMore(false);
    });
  };
  return (
    <RecipesBrowseList
      recipes={rows}
      search={search}
      onSearchChange={setSearch}
      onOpenDetail={() => {}}
      hasMoreRemote={hasMore}
      isLoadingMore={loadingMore}
      onLoadMore={loadMore}
    />
  );
}

afterEach(cleanup);

describe('RecipesBrowseList over a paged catalog', () => {
  it('pages on to find a match that is not in the loaded window', async () => {
    const onRequest = vi.fn();
    render(<Harness onRequest={onRequest} />);
    await act(async () => {
      fireEvent.change(screen.getByTestId('recipes-search'), { target: { value: 'invoice' } });
    });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('no-results')).toBeNull();
    expect(screen.getByText('Invoice chaser')).toBeTruthy();
  });

  it('shows the empty state once a page request fails, without retrying in a loop', async () => {
    const onRequest = vi.fn();
    render(<Harness fail onRequest={onRequest} />);
    await act(async () => {
      fireEvent.change(screen.getByTestId('recipes-search'), { target: { value: 'invoice' } });
    });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('no-results')).toBeTruthy();
  });

  it('marks the header count as partial while more pages exist', async () => {
    render(<Harness onRequest={() => {}} />);
    expect(screen.getByTestId('recipes-available-count').textContent).toBe('3+');
  });
});
