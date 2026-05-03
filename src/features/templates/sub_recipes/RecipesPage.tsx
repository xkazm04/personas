import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MOCK_RECIPES } from './mockRecipes';
import { RecipesBrowseList } from './components/RecipesBrowseList';
import { RecipeDetailPanel } from './components/RecipeDetailPanel';
import { RecipeAdoptionModal } from './components/RecipeAdoptionModal';

/**
 * Recipes catalog top-level page — mounted from `DesignReviewsPage` when
 * the templates 2nd-level sidebar's `recipes` entry is active.
 *
 * Manages two pieces of view state:
 *   - `selectedRecipeId` — null = browse list, otherwise = detail view
 *   - `adoptingRecipeId` — non-null = adoption modal open over the detail
 *
 * Recipe data source is the hand-authored `MOCK_RECIPES` array. When the
 * Rust schema lands, swap that source for a Tauri-backed query without
 * touching this file.
 */
export function RecipesPage() {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [adoptingRecipeId, setAdoptingRecipeId] = useState<string | null>(null);

  const recipes = MOCK_RECIPES;
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
              onOpenDetail={(id) => setSelectedRecipeId(id)}
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
