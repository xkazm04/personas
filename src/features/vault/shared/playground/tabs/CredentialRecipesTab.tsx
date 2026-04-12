import { useTranslation } from '@/i18n/useTranslation';
import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, Sparkles } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { Button } from '@/features/shared/components/buttons';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import * as recipeApi from '@/api/templates/recipes';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useToastStore } from '@/stores/toastStore';
import { useRecipeGenerator } from '@/hooks/design/template/useRecipeGenerator';
import { RecipePlaygroundModal } from '@/features/recipes/sub_playground/components/RecipePlaygroundModal';
import { RecipeCreateFlow } from './RecipeCreateFlow';
import { RecipeListItem } from './RecipeListItem';

interface CredentialRecipesTabProps {
  credentialId: string;
}

export function CredentialRecipesTab({ credentialId }: CredentialRecipesTabProps) {
  const { t } = useTranslation();
  const vt = t.vault.playground_extra;
  const fetchRecipes = usePipelineStore((s) => s.fetchRecipes);

  const [recipes, setRecipes] = useState<RecipeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playgroundRecipe, setPlaygroundRecipe] = useState<RecipeDefinition | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  const generator = useRecipeGenerator();

  const loadRecipes = useCallback(async () => {
    try {
      const r = await recipeApi.getCredentialRecipes(credentialId);
      setRecipes(r);
    } catch {
      // intentional: non-critical -- initial recipe list load; empty list shown on failure
    } finally {
      setLoading(false);
    }
  }, [credentialId]);

  useEffect(() => {
    loadRecipes();
  }, [loadRecipes]);

  useEffect(() => {
    return () => generator.reset();
  }, [credentialId]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setError(null);
    setTerminalExpanded(false);
    await generator.start(credentialId, description.trim());
  }, [credentialId, description, generator]);

  const handleSaveDraft = useCallback(async () => {
    if (!generator.draft) return;
    setSaving(true);
    setError(null);
    try {
      const draft = generator.draft;
      await recipeApi.createRecipe({
        credential_id: credentialId,
        use_case_id: null,
        name: draft.name,
        description: draft.description,
        category: draft.category,
        prompt_template: draft.prompt_template,
        input_schema: draft.input_schema,
        output_contract: null,
        tool_requirements: null,
        credential_requirements: credentialId,
        model_preference: null,
        sample_inputs: draft.sample_inputs ?? null,
        tags: draft.tags,
        icon: null,
        color: null,
      });
      generator.reset();
      setCreating(false);
      setDescription('');
      await loadRecipes();
      await fetchRecipes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [generator, credentialId, loadRecipes, fetchRecipes]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await recipeApi.deleteRecipe(id);
      await loadRecipes();
      await fetchRecipes();
    } catch {
      useToastStore.getState().addToast('Failed to delete recipe', 'error');
    }
  }, [loadRecipes, fetchRecipes]);

  const handleCancelCreate = useCallback(() => {
    if (generator.phase === 'generating') {
      generator.cancel();
    }
    generator.reset();
    setCreating(false);
    setDescription('');
    setError(null);
  }, [generator]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground/60">
        <LoadingSpinner size="lg" label="Loading recipes" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground/90">{vt.recipes_title}</h3>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            Reusable automation templates for this credential
          </p>
        </div>
        {!creating && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setCreating(true)}
          >
            New Recipe
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {creating && (
          <RecipeCreateFlow
            description={description}
            setDescription={setDescription}
            generator={generator}
            error={error}
            saving={saving}
            terminalExpanded={terminalExpanded}
            setTerminalExpanded={setTerminalExpanded}
            onGenerate={handleGenerate}
            onSaveDraft={handleSaveDraft}
            onCancel={handleCancelCreate}
          />
        )}

        {recipes.length === 0 && !creating ? (
          <EmptyIllustration
            icon={BookOpen}
            heading={vt.no_recipes}
            description="Create your first recipe by describing what you want to automate with this credential."
            cta={
              <Button
                variant="primary"
                size="sm"
                icon={<Sparkles className="w-3.5 h-3.5" />}
                onClick={() => setCreating(true)}
              >
                Create First Recipe
              </Button>
            }
            className="py-16"
          />
        ) : (
          <div className="space-y-2">
            {recipes.map((recipe) => (
              <RecipeListItem
                key={recipe.id}
                recipe={recipe}
                isExpanded={expandedId === recipe.id}
                onToggleExpand={() => setExpandedId(expandedId === recipe.id ? null : recipe.id)}
                onOpenPlayground={() => setPlaygroundRecipe(recipe)}
                onDelete={() => handleDelete(recipe.id)}
              />
            ))}
          </div>
        )}
      </div>

      {playgroundRecipe && (
          <RecipePlaygroundModal
            recipe={playgroundRecipe}
            onClose={() => setPlaygroundRecipe(null)}
          />
        )}
    </div>
  );
}
