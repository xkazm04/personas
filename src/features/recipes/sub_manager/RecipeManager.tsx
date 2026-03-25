import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, Plus, Search, X } from 'lucide-react';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useToastStore } from '@/stores/toastStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { RecipeList } from '@/features/recipes/sub_list/RecipeList';
import { RecipeEditor } from '@/features/recipes/sub_editor/RecipeEditor';
import { RecipePlaygroundModal } from '@/features/recipes/sub_playground/RecipePlaygroundModal';
import { useRecipeViewFSM } from '@/features/recipes/hooks/useRecipeViewFSM';

export function RecipeManager() {
  const recipes = usePipelineStore((s) => s.recipes);
  const fetchRecipes = usePipelineStore((s) => s.fetchRecipes);
  const deleteRecipe = usePipelineStore((s) => s.deleteRecipe);

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
        useToastStore.getState().addToast('Failed to load recipes', 'error');
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
        useToastStore.getState().addToast('Failed to delete recipe', 'error');
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
              className="btn-md flex items-center gap-1.5 bg-primary font-medium text-white hover:bg-primary/90 transition-colors"
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
              className="w-full rounded-xl border border-border/50 bg-background/50 pl-8 pr-8 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/50"
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
        {viewState.view === 'list' && (
            <div
              key="list"
              className="animate-fade-slide-in h-full"
            >
              <RecipeList
                recipes={filteredRecipes}
                search={search}
                onEdit={(id) => dispatch({ type: 'GO_EDIT', recipeId: id })}
                onPlayground={(id) => dispatch({ type: 'GO_PLAYGROUND', recipeId: id })}
                onDelete={handleDelete}
              />
            </div>
          )}

          {viewState.view === 'create' && (
            <div
              key="create"
              className="animate-fade-slide-in h-full"
            >
              <RecipeEditor recipe={null} onSaved={handleSaved} onCancel={() => dispatch({ type: 'GO_LIST' })} />
            </div>
          )}

          {viewState.view === 'edit' && editingRecipe && (
            <div
              key={`edit-${viewState.recipeId}`}
              className="animate-fade-slide-in h-full"
            >
              <RecipeEditor
                recipe={editingRecipe}
                onSaved={handleSaved}
                onCancel={() => dispatch({ type: 'GO_LIST' })}
              />
            </div>
          )}

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
