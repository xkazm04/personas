import { useState, useCallback } from 'react';
import { BookOpen, X } from 'lucide-react';
import { RecipePageFlipLoader } from '../../shared/RecipePageFlipLoader';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { RecipeExecutionResult } from '@/lib/bindings/RecipeExecutionResult';
import { RecipeCard } from './RecipeCard';
import { useToastStore } from '@/stores/toastStore';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { RecipeBookIllustration } from '../../shared/RecipeBookIllustration';
import * as recipeApi from '@/api/templates/recipes';

interface RecipeListProps {
  recipes: RecipeDefinition[];
  search: string;
  onEdit: (id: string) => void;
  onPlayground: (id: string) => void;
  onDelete: (id: string) => void;
}

export function RecipeList({ recipes, search, onEdit, onPlayground, onDelete }: RecipeListProps) {
  const [quickTestResults, setQuickTestResults] = useState<Record<string, RecipeExecutionResult | null>>({});
  const [quickTestLoading, setQuickTestLoading] = useState<Record<string, boolean>>({});

  const handleQuickTest = useCallback(async (id: string) => {
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe?.sample_inputs) return;

    setQuickTestLoading((prev) => ({ ...prev, [id]: true }));
    setQuickTestResults((prev) => ({ ...prev, [id]: null }));

    try {
      const inputData = JSON.parse(recipe.sample_inputs) as Record<string, unknown>;
      const result = await recipeApi.executeRecipe({ recipe_id: id, input_data: inputData });
      setQuickTestResults((prev) => ({ ...prev, [id]: result }));
    } catch {
      useToastStore.getState().addToast('Quick test failed', 'error');
      setQuickTestResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } finally {
      setQuickTestLoading((prev) => ({ ...prev, [id]: false }));
    }
  }, [recipes]);

  const dismissResult = useCallback((id: string) => {
    setQuickTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  if (recipes.length === 0) {
    return (
      <EmptyState
        icon={search ? BookOpen : undefined}
        title={search ? 'No matching recipes' : 'No recipes yet'}
        description={
          search
            ? 'Try a different search term.'
            : 'Create your first reusable LLM recipe to get started.'
        }
      >
        {!search && <RecipeBookIllustration className="mb-1" />}
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-3 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
      {recipes.map((recipe) => (
          <div className="animate-fade-slide-in"
            key={recipe.id}
          >
            <RecipeCard
              recipe={recipe}
              onEdit={onEdit}
              onPlayground={onPlayground}
              onDelete={onDelete}
              onQuickTest={handleQuickTest}
            />

            {/* Quick test loading */}
            {quickTestLoading[recipe.id] && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-border/40 bg-card/30 px-3 py-2 text-sm text-muted-foreground">
                <RecipePageFlipLoader className="text-primary" /> Running quick test...
              </div>
            )}

            {/* Quick test result */}
            {quickTestResults[recipe.id] && (
              <div className="mt-2 rounded-lg border border-border/40 bg-card/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Quick Test Result</p>
                  <button
                    onClick={() => dismissResult(recipe.id)}
                    className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <PromptTemplateRenderer
                  content={quickTestResults[recipe.id]!.rendered_prompt}
                  maxHeight="max-h-40"
                />
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
