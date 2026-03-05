import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, Plus, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { RecipeList } from '@/features/recipes/sub_list/RecipeList';
import { RecipeEditor } from '@/features/recipes/sub_editor/RecipeEditor';
import { RecipePlaygroundModal } from '@/features/recipes/sub_playground/RecipePlaygroundModal';
import { useRecipeViewFSM } from '@/features/recipes/hooks/useRecipeViewFSM';

export function RecipeManager() {
  const recipes = usePersonaStore((s) => s.recipes);
  const fetchRecipes = usePersonaStore((s) => s.fetchRecipes);
  const deleteRecipe = usePersonaStore((s) => s.deleteRecipe);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const { state: viewState, dispatch, filteredRecipes, editingRecipe, playgroundRecipe } =
    useRecipeViewFSM(recipes, search);

  useEffect(() => {
    const init = async () => {
      try {
        await fetchRecipes();
      } catch {
        // Error set by store
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchRecipes]);

  // Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteRecipe(id);
      } catch {
        // Error set by store
      }
    },
    [deleteRecipe],
  );

  const handleSaved = useCallback(() => {
    dispatch({ type: 'GO_LIST' });
  }, [dispatch]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<BookOpen className="w-5 h-5 text-primary" />}
        iconColor="primary"
        title="Recipes"
        subtitle={
          loading
            ? 'Loading...'
            : `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`
        }
        actions={
          viewState.view === 'list' ? (
            <button
              onClick={() => dispatch({ type: 'GO_CREATE' })}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Recipe
            </button>
          ) : undefined
        }
      >
        {viewState.view === 'list' && (
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipes... (Ctrl+K)"
              className="w-full rounded-md border border-border/50 bg-background/50 pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </ContentHeader>

      <ContentBody>
        <AnimatePresence mode="wait">
          {viewState.view === 'list' && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <RecipeList
                recipes={filteredRecipes}
                search={search}
                onEdit={(id) => dispatch({ type: 'GO_EDIT', recipeId: id })}
                onPlayground={(id) => dispatch({ type: 'GO_PLAYGROUND', recipeId: id })}
                onDelete={handleDelete}
              />
            </motion.div>
          )}

          {viewState.view === 'create' && (
            <motion.div
              key="create"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              <RecipeEditor recipe={null} onSaved={handleSaved} onCancel={() => dispatch({ type: 'GO_LIST' })} />
            </motion.div>
          )}

          {viewState.view === 'edit' && editingRecipe && (
            <motion.div
              key={`edit-${viewState.recipeId}`}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              <RecipeEditor
                recipe={editingRecipe}
                onSaved={handleSaved}
                onCancel={() => dispatch({ type: 'GO_LIST' })}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Playground Modal */}
        {viewState.view === 'playground' && playgroundRecipe && (
          <RecipePlaygroundModal
            recipe={playgroundRecipe}
            onClose={() => dispatch({ type: 'GO_LIST' })}
          />
        )}
      </ContentBody>
    </ContentBox>
  );
}
