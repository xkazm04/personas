import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { usePipelineStore } from '@/stores/pipelineStore';
import { silentCatch } from '@/lib/silentCatch';
import { RECIPE_PAGE_SIZE } from '@/api/recipes/recipes';
import { RecipesBrowseList } from './components/RecipesBrowseList';
import { RecipeDetailPanel } from './components/RecipeDetailPanel';
import { RecipeAdoptionModal } from './components/RecipeAdoptionModal';
import { recipeDefinitionsToRecipes } from './libs/recipeAdapter';

/**
 * Recipes catalog top-level page — mounted from `DesignReviewsPage` when
 * the templates 2nd-level sidebar's `recipes` entry is active.
 *
 * Manages two pieces of view state:
 *   - `selectedRecipeId` — null = browse list, otherwise = detail view
 *   - `adoptingRecipeId` — non-null = adoption modal open over the detail
 *
 * Stage E.3 — wired to live recipes. Pulls from `usePipelineStore` (the
 * canonical Zustand catalog populated by `list_recipes`, seeded by Stage
 * B Phase 2.4 on app boot) and adapts each `RecipeDefinition` into the
 * rich frontend `Recipe` shape via `recipeDefinitionsToRecipes`.
 * Adoption stays on the existing client-side `useAdoption` hook — that
 * already writes a fully-substituted `DesignUseCase` into the persona's
 * `design_context`, which is the canonical adoption surface.
 */
export function RecipesPage() {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [adoptingRecipeId, setAdoptingRecipeId] = useState<string | null>(null);
  // Lifted so the detail view's tag chips can jump back to a filtered browse.
  const [search, setSearch] = useState('');

  const { definitions, fetchRecipes, recipesHasMore } = usePipelineStore(
    useShallow((s) => ({
      definitions: s.recipes,
      fetchRecipes: s.fetchRecipes,
      recipesHasMore: s.recipesHasMore,
    })),
  );

  // First page only. The boot-time recipe seed (Phase 2.4) populates the
  // DB before the frontend renders; this fetch lands one viewport-sized
  // page into the store instead of hydrating the whole catalog (1000+)
  // just to paint 20 table rows. `isLoading` is only the cold-empty
  // flag — a rejected fetch releases it so the empty state can appear.
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchRecipes({ limit: RECIPE_PAGE_SIZE, offset: 0 })
      .catch(silentCatch('RecipesPage.fetchRecipes'))
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [fetchRecipes]);

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore || !recipesHasMore) return;
    setIsLoadingMore(true);
    fetchRecipes({ limit: RECIPE_PAGE_SIZE, offset: definitions.length, append: true })
      .catch(silentCatch('RecipesPage.fetchRecipes.more'))
      .finally(() => setIsLoadingMore(false));
  }, [isLoadingMore, recipesHasMore, fetchRecipes, definitions.length]);

  // Memoise the adapter pass — parses each loaded page's prompt_template
  // once per call, not the whole catalog.
  const recipes = useMemo(() => recipeDefinitionsToRecipes(definitions), [definitions]);
  const selectedRecipe = selectedRecipeId
    ? recipes.find((r) => r.id === selectedRecipeId) ?? null
    : null;
  const adoptingRecipe = adoptingRecipeId
    ? recipes.find((r) => r.id === adoptingRecipeId) ?? null
    : null;

  return (
    <div className="flex flex-col h-full">
      <AnimatePresence mode="wait" initial={false}>
        {selectedRecipe ? (
          <motion.div
            key={`detail-${selectedRecipe.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="flex-1 min-h-0"
          >
            <RecipeDetailPanel
              recipe={selectedRecipe}
              onBack={() => setSelectedRecipeId(null)}
              onAdopt={() => setAdoptingRecipeId(selectedRecipe.id)}
              onTagClick={(tag) => {
                setSearch(tag);
                setSelectedRecipeId(null);
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="browse"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-1 min-h-0"
          >
            <RecipesBrowseList
              recipes={recipes}
              isLoading={isLoading}
              search={search}
              onSearchChange={setSearch}
              onOpenDetail={(id) => setSelectedRecipeId(id)}
              hasMoreRemote={recipesHasMore}
              onLoadMore={handleLoadMore}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {adoptingRecipe && (
        <RecipeAdoptionModal
          recipe={adoptingRecipe}
          onClose={() => setAdoptingRecipeId(null)}
          onAdopted={() => {
            // Adoption succeeded — close the modal *and* return to browse
            // so the user gets feedback ("done, here are more recipes").
            // The toast from useAdoption tells them where the use case landed.
            setAdoptingRecipeId(null);
            setSelectedRecipeId(null);
          }}
        />
      )}
    </div>
  );
}
