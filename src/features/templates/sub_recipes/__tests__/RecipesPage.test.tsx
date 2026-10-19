/**
 * A catalog fetch that fails must say so. The browse list's empty state reads
 * "no recipes match", which after a failed first page is a claim about rows
 * that never arrived. The user pressed nothing, so the failure is shown
 * inline with Retry (census unsolicited-failure-as-toast), not toasted.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const reported: string[] = [];

vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (context: string) => () => { reported.push(`toast:${context}`); },
  silentCatch: (context: string) => () => { reported.push(`silent:${context}`); },
}));

const fetchRecipes = vi.fn(() => Promise.reject({ error: 'db locked', kind: 'Internal' }));
const STORE = { recipes: [], recipesHasMore: false, fetchRecipes };
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: unknown) => unknown) => selector(STORE),
}));
vi.mock('../components/RecipesBrowseList', () => ({ RecipesBrowseList: () => <div /> }));
vi.mock('../components/RecipeDetailPanel', () => ({ RecipeDetailPanel: () => <div /> }));
vi.mock('../components/RecipeAdoptionModal', () => ({ RecipeAdoptionModal: () => <div /> }));

import { RecipesPage } from '../RecipesPage';

afterEach(() => {
  cleanup();
  reported.length = 0;
});

describe('RecipesPage', () => {
  it('shows a failed first page inline, without a toast, and Retry refetches', async () => {
    fetchRecipes.mockClear();
    await act(async () => {
      render(<RecipesPage />);
    });
    expect(fetchRecipes).toHaveBeenCalledTimes(1);
    expect(reported).toEqual(['silent:RecipesPage.fetchRecipes']);
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    });
    expect(fetchRecipes).toHaveBeenCalledTimes(2);
  });
});
