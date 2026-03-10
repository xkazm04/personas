import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Loader2, X } from 'lucide-react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { RecipeExecutionResult } from '@/lib/bindings/RecipeExecutionResult';
import { RecipeCard } from './RecipeCard';
import { useToastStore } from '@/stores/toastStore';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
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
        icon={BookOpen}
        title={search ? 'No matching recipes' : 'No recipes yet'}
        description={
          search
            ? 'Try a different search term.'
            : 'Create your first reusable LLM recipe to get started.'
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
      <AnimatePresence mode="popLayout">
        {recipes.map((recipe) => (
          <motion.div
            key={recipe.id}
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
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
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running quick test...
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
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
