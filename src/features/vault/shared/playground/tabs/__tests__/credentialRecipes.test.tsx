import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';

/**
 * `RecipeCreateFlow` and `RecipeListItem` shipped in this folder with no
 * consumer anywhere in `src/`, `getCredentialRecipes` exists for exactly this
 * credential-scoped list, and `vault.shared` already carried a full panel's
 * worth of translated copy that nothing rendered. A working request in the
 * explorer could only become an automation by retyping it elsewhere.
 */

const getCredentialRecipes = vi.fn();
const createRecipe = vi.fn();
const deleteRecipe = vi.fn();
const generatorStart = vi.fn();

vi.mock('@/api/recipes/recipes', () => ({
  getCredentialRecipes: (...a: unknown[]) => getCredentialRecipes(...a),
  createRecipe: (...a: unknown[]) => createRecipe(...a),
  deleteRecipe: (...a: unknown[]) => deleteRecipe(...a),
}));

let draft: Record<string, unknown> | null = null;
vi.mock('@/hooks/design/template/useRecipeGenerator', () => ({
  useRecipeGenerator: () => ({
    phase: draft ? 'reviewing' : 'idle',
    lines: [],
    draft,
    error: null,
    start: generatorStart,
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

import { RecipesPanel } from '../RecipesPanel';
import { recipeSeedFromRequest, useCredentialRecipes } from '../useCredentialRecipes';

const RECIPE = {
  id: 'r-1',
  project_id: 'p',
  credential_id: 'cred-1',
  name: 'List open PRs',
  description: null,
  category: null,
  prompt_template: 'List open PRs for {repo}',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_builtin: false,
} as never;

describe('recipeSeedFromRequest', () => {
  it('describes the request the user just ran', () => {
    expect(recipeSeedFromRequest('get', '/repos/acme/app/pulls')).toBe('GET /repos/acme/app/pulls');
  });
});

describe('useCredentialRecipes', () => {
  beforeEach(() => {
    draft = null;
    getCredentialRecipes.mockReset().mockResolvedValue([]);
    createRecipe.mockReset().mockResolvedValue(RECIPE);
    deleteRecipe.mockReset().mockResolvedValue(true);
    generatorStart.mockReset();
  });

  it('generates against the credential, so the draft calls THIS connector', async () => {
    const h = renderHook(() => useCredentialRecipes('cred-1'));
    await waitFor(() => expect(h.result.current.isLoading).toBe(false));
    act(() => { h.result.current.beginCreate('GET /user/repos'); });
    expect(h.result.current.description).toBe('GET /user/repos');
    act(() => { h.result.current.generate(); });
    expect(generatorStart).toHaveBeenCalledWith('cred-1', 'GET /user/repos');
  });

  it('persists the accepted draft against the credential and reloads the list', async () => {
    draft = {
      name: 'List open PRs',
      description: 'd',
      category: 'vcs',
      prompt_template: 'tpl',
      input_schema: null,
      tags: null,
      sample_inputs: null,
      example_result: null,
    };
    const h = renderHook(() => useCredentialRecipes('cred-1'));
    await waitFor(() => expect(h.result.current.isLoading).toBe(false));
    getCredentialRecipes.mockResolvedValue([RECIPE]);

    await act(async () => { await h.result.current.saveDraft(); });

    expect(createRecipe).toHaveBeenCalledTimes(1);
    expect(createRecipe.mock.calls[0]![0]).toMatchObject({
      credential_id: 'cred-1',
      name: 'List open PRs',
      prompt_template: 'tpl',
    });
    await waitFor(() => expect(h.result.current.recipes).toHaveLength(1));
    expect(h.result.current.isCreating).toBe(false);
  });

  it('drops a deleted recipe from the list', async () => {
    getCredentialRecipes.mockResolvedValue([RECIPE]);
    const h = renderHook(() => useCredentialRecipes('cred-1'));
    await waitFor(() => expect(h.result.current.recipes).toHaveLength(1));
    await act(async () => { await h.result.current.remove('r-1'); });
    expect(deleteRecipe).toHaveBeenCalledWith('r-1');
    expect(h.result.current.recipes).toEqual([]);
  });
});

describe('RecipesPanel', () => {
  beforeEach(() => {
    draft = null;
    getCredentialRecipes.mockReset().mockResolvedValue([]);
  });

  function Harness() {
    const state = useCredentialRecipes('cred-1');
    return <RecipesPanel state={state} />;
  }

  it('renders a saved recipe rather than the empty state', async () => {
    getCredentialRecipes.mockResolvedValue([RECIPE]);
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('List open PRs')).toBeTruthy());
  });

  it('opens the create flow from the panel', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('credential-recipes-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('credential-recipes-new'));
    // The create flow's own textarea, which had no consumer before this.
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy());
  });
});
