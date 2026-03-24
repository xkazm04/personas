import { useState, useEffect, useCallback, useMemo } from 'react';
import { BookOpen, Plus, Play, Unlink } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useToastStore } from '@/stores/toastStore';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { RecipePicker } from './RecipePicker';
import { RecipePlaygroundModal } from '../../sub_playground/components/RecipePlaygroundModal';
import { PuzzlePieceIllustration } from '../../shared/PuzzlePieceIllustration';

interface LinkedRecipesSectionProps {
  personaId: string;
}

export function LinkedRecipesSection({ personaId }: LinkedRecipesSectionProps) {
  const fetchPersonaRecipes = usePipelineStore((s) => s.fetchPersonaRecipes);
  const linkRecipeToPersona = usePipelineStore((s) => s.linkRecipeToPersona);
  const unlinkRecipeFromPersona = usePipelineStore((s) => s.unlinkRecipeFromPersona);

  const [linkedRecipes, setLinkedRecipes] = useState<RecipeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playgroundRecipe, setPlaygroundRecipe] = useState<RecipeDefinition | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const loadLinked = useCallback(async () => {
    try {
      const recipes = await fetchPersonaRecipes(personaId);
      setLinkedRecipes(recipes);
    } catch {
      useToastStore.getState().addToast('Failed to load linked recipes', 'error');
    } finally {
      setLoading(false);
    }
  }, [personaId, fetchPersonaRecipes]);

  useEffect(() => {
    loadLinked();
  }, [loadLinked]);

  const linkedIds = useMemo(() => new Set(linkedRecipes.map((r) => r.id)), [linkedRecipes]);

  const handleLink = useCallback(async (recipe: RecipeDefinition) => {
    setPickerOpen(false);
    try {
      await linkRecipeToPersona(personaId, recipe.id);
      await loadLinked();
    } catch {
      useToastStore.getState().addToast('Failed to link recipe', 'error');
    }
  }, [personaId, linkRecipeToPersona, loadLinked]);

  const handleUnlink = useCallback(async (recipeId: string) => {
    setUnlinkingId(recipeId);
    try {
      await unlinkRecipeFromPersona(personaId, recipeId);
      await loadLinked();
    } catch {
      useToastStore.getState().addToast('Failed to unlink recipe', 'error');
    } finally {
      setUnlinkingId(null);
    }
  }, [personaId, unlinkRecipeFromPersona, loadLinked]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground/60">
        <LoadingSpinner size="xs" /> Loading linked recipes...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader
          icon={<BookOpen className="w-3.5 h-3.5" />}
          label={`${linkedRecipes.length} linked recipe${linkedRecipes.length !== 1 ? 's' : ''}`}
        />
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-primary hover:bg-primary/10 transition-colors"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {linkedRecipes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 px-4 py-6 flex flex-col items-center text-center gap-1">
          <PuzzlePieceIllustration />
          <p className="text-sm text-muted-foreground/60">
            No recipes linked yet. Click &quot;Add&quot; to link recipes from the library.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {linkedRecipes.map((recipe) => (
            <div
              key={recipe.id}
              className="group flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:border-border/60 transition-colors"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                <BookOpen className="w-3 h-3 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{recipe.name}</p>
                {recipe.description && (
                  <p className="text-sm text-muted-foreground/60 truncate">{recipe.description}</p>
                )}
              </div>
              {recipe.category && (
                <span className="rounded-lg border border-border/40 bg-muted/20 px-1.5 py-0.5 text-sm text-muted-foreground">
                  {recipe.category}
                </span>
              )}
              <button
                onClick={() => setPlaygroundRecipe(recipe)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                <Play className="w-3 h-3" /> Run
              </button>
              <button
                onClick={() => handleUnlink(recipe.id)}
                disabled={unlinkingId === recipe.id}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
              >
                {unlinkingId === recipe.id ? (
                  <LoadingSpinner size="xs" />
                ) : (
                  <Unlink className="w-3 h-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Picker Modal */}
      {pickerOpen && (
          <RecipePicker
            linkedRecipeIds={linkedIds}
            onSelect={handleLink}
            onClose={() => setPickerOpen(false)}
          />
        )}

      {/* Playground Modal */}
      {playgroundRecipe && (
          <RecipePlaygroundModal
            recipe={playgroundRecipe}
            onClose={() => setPlaygroundRecipe(null)}
          />
        )}
    </div>
  );
}
