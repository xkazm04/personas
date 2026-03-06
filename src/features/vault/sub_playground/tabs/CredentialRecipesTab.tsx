import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, Settings, Trash2, Loader2, Sparkles, X, Save, ChevronDown, ChevronRight } from 'lucide-react';
import { PromptTemplateRenderer } from '@/features/shared/components/PromptTemplateRenderer';
import { AnimatePresence, motion } from 'framer-motion';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import * as recipeApi from '@/api/recipes';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { useRecipeGenerator } from '@/hooks/design/useRecipeGenerator';
import { TerminalStrip } from '@/features/shared/components/TerminalStrip';
import { EstimatedProgressBar } from '@/features/shared/components/EstimatedProgressBar';
import { RecipePlaygroundModal } from '@/features/recipes/sub_playground/RecipePlaygroundModal';

interface CredentialRecipesTabProps {
  credentialId: string;
}

export function CredentialRecipesTab({ credentialId }: CredentialRecipesTabProps) {
  const fetchRecipes = usePersonaStore((s) => s.fetchRecipes);

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
      // intentional: non-critical — initial recipe list load; empty list shown on failure
    } finally {
      setLoading(false);
    }
  }, [credentialId]);

  useEffect(() => {
    loadRecipes();
  }, [loadRecipes]);

  // Reset generator when switching credentials or cancelling
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
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground/60">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading recipes...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground/90">
            Recipes
          </h3>
          <p className="text-sm text-muted-foreground/60 mt-0.5">
            Reusable automation templates for this credential
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Recipe
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Create Flow */}
        <AnimatePresence>
          {creating && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 mb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground/80 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    Create Recipe
                  </h4>
                  <button
                    onClick={handleCancelCreate}
                    className="p-1 rounded-lg text-muted-foreground/50 hover:text-foreground/80 hover:bg-muted/30 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">
                    What should this recipe do?
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., List all open pull requests for a repository and summarize the changes..."
                    rows={3}
                    autoFocus
                    className="w-full rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 resize-none"
                  />
                </div>

                {/* Generate button — only when idle or error */}
                {(generator.phase === 'idle' || generator.phase === 'error') && !generator.draft && (
                  <button
                    onClick={handleGenerate}
                    disabled={!description.trim()}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate with AI
                  </button>
                )}

                {/* Progress + Terminal strip — visible while generating */}
                {generator.phase === 'generating' && (
                  <div className="space-y-2">
                    <EstimatedProgressBar isRunning estimatedSeconds={30} />
                    <TerminalStrip
                    lastLine={generator.lines[generator.lines.length - 1] ?? 'Starting...'}
                    lines={generator.lines}
                    isRunning
                    isExpanded={terminalExpanded}
                    onToggle={() => setTerminalExpanded((p) => !p)}
                    expandedMaxHeight="max-h-48"
                  />
                  </div>
                )}

                {/* Error */}
                {(error || generator.error) && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                    {error || generator.error}
                  </div>
                )}

                {/* Draft Preview — after LLM completes */}
                {generator.draft && (
                  <div className="rounded-lg border border-border/40 bg-card/50 p-4 space-y-3">
                    {/* Terminal strip (collapsed) showing what happened */}
                    {generator.lines.length > 0 && (
                      <TerminalStrip
                        lastLine={generator.lines[generator.lines.length - 1] ?? ''}
                        lines={generator.lines}
                        isRunning={false}
                        isExpanded={terminalExpanded}
                        onToggle={() => setTerminalExpanded((p) => !p)}
                        onClear={() => setTerminalExpanded(false)}
                        expandedMaxHeight="max-h-32"
                      />
                    )}

                    <div className="flex items-center justify-between">
                      <h5 className="text-sm font-semibold text-foreground/80">Generated Recipe</h5>
                      {generator.draft.category && (
                        <span className="rounded-lg border border-border/40 bg-muted/20 px-2 py-0.5 text-sm text-muted-foreground">
                          {generator.draft.category}
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="text-sm text-muted-foreground/60 mb-0.5">Name</p>
                      <p className="text-sm text-foreground">{generator.draft.name}</p>
                    </div>

                    {generator.draft.description && (
                      <div>
                        <p className="text-sm text-muted-foreground/60 mb-0.5">Description</p>
                        <p className="text-sm text-foreground/80">{generator.draft.description}</p>
                      </div>
                    )}

                    <div>
                      <p className="text-sm text-muted-foreground/60 mb-0.5">Prompt Template</p>
                      <PromptTemplateRenderer content={generator.draft.prompt_template} maxHeight="max-h-40" />
                    </div>

                    {generator.draft.example_result && (
                      <div>
                        <p className="text-sm text-muted-foreground/60 mb-0.5">Example Result</p>
                        <pre className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm font-mono text-foreground/70 whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {generator.draft.example_result}
                        </pre>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleSaveDraft}
                        disabled={saving}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Accept & Save
                      </button>
                      <button
                        onClick={() => {
                          generator.reset();
                          handleGenerate();
                        }}
                        className="rounded-xl px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                      >
                        Regenerate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recipe List */}
        {recipes.length === 0 && !creating ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 mb-3">
              <BookOpen className="w-5 h-5 text-primary/60" />
            </div>
            <h4 className="text-sm font-medium text-foreground/80 mb-1">No recipes yet</h4>
            <p className="text-sm text-muted-foreground/60 max-w-[280px]">
              Create your first recipe by describing what you want to automate with this credential.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors mt-4"
            >
              <Sparkles className="w-3.5 h-3.5" /> Create First Recipe
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recipes.map((recipe) => {
              const isExpanded = expandedId === recipe.id;
              return (
                <div
                  key={recipe.id}
                  className="rounded-xl border border-border/40 bg-card/30 overflow-hidden hover:border-border/60 transition-colors"
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : recipe.id)}
                      className="text-muted-foreground/50 hover:text-foreground/80 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
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
                      <span className="rounded-lg border border-border/40 bg-muted/20 px-2 py-0.5 text-sm text-muted-foreground shrink-0">
                        {recipe.category}
                      </span>
                    )}
                    <button
                      onClick={() => setPlaygroundRecipe(recipe)}
                      className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                      title="Open settings"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(recipe.id)}
                      className="rounded-lg p-1.5 text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-3 pt-0 border-t border-border/30 space-y-2">
                          <div>
                            <p className="text-sm text-muted-foreground/50 mt-2 mb-0.5">Prompt Template</p>
                            <PromptTemplateRenderer content={recipe.prompt_template || '(empty)'} maxHeight="max-h-40" />
                          </div>
                          <div className="flex gap-4 text-sm text-muted-foreground/50">
                            <span>Created: {new Date(recipe.created_at).toLocaleDateString()}</span>
                            <span>Updated: {new Date(recipe.updated_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Playground Modal */}
      <AnimatePresence>
        {playgroundRecipe && (
          <RecipePlaygroundModal
            recipe={playgroundRecipe}
            onClose={() => setPlaygroundRecipe(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
