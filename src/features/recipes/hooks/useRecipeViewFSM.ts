import { useReducer, useMemo } from 'react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';

// ── Discriminated union: each state carries exactly the data it needs ──

export type RecipeViewState =
  | { view: 'list' }
  | { view: 'create' }
  | { view: 'edit'; recipeId: string }
  | { view: 'playground'; recipeId: string };

// ── Typed actions ──

export type RecipeViewAction =
  | { type: 'GO_LIST' }
  | { type: 'GO_CREATE' }
  | { type: 'GO_EDIT'; recipeId: string }
  | { type: 'GO_PLAYGROUND'; recipeId: string };

// ── Reducer ──

const INITIAL_STATE: RecipeViewState = { view: 'list' };

function reducer(state: RecipeViewState, action: RecipeViewAction): RecipeViewState {
  switch (action.type) {
    case 'GO_LIST':
      return { view: 'list' };
    case 'GO_CREATE':
      return { view: 'create' };
    case 'GO_EDIT':
      return { view: 'edit', recipeId: action.recipeId };
    case 'GO_PLAYGROUND':
      return { view: 'playground', recipeId: action.recipeId };
    default:
      return state;
  }
}

// ── Hook ──

export function useRecipeViewFSM(recipes: RecipeDefinition[], search: string) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const filteredRecipes = useMemo(() => {
    if (!search.trim()) return recipes;
    const q = search.toLowerCase();
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.category ?? '').toLowerCase().includes(q) ||
        (r.tags ?? '').toLowerCase().includes(q),
    );
  }, [recipes, search]);

  const editingRecipe = useMemo(() => {
    if (state.view === 'edit') {
      return recipes.find((r) => r.id === state.recipeId) ?? null;
    }
    return null;
  }, [state, recipes]);

  const playgroundRecipe = useMemo(() => {
    if (state.view === 'playground') {
      return recipes.find((r) => r.id === state.recipeId) ?? null;
    }
    return null;
  }, [state, recipes]);

  return { state, dispatch, filteredRecipes, editingRecipe, playgroundRecipe };
}
