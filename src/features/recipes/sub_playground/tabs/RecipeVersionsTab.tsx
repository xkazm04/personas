import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Check, RotateCcw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { RecipePageFlipLoader } from '../../shared/RecipePageFlipLoader';
import { useToastStore } from '@/stores/toastStore';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { RecipeVersion } from '@/lib/bindings/RecipeVersion';
import * as recipeApi from '@/api/templates/recipes';
import { useRecipeVersioning } from '@/hooks/design/template/useRecipeVersioning';
import { EstimatedProgressBar } from '@/features/shared/components/progress/EstimatedProgressBar';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import { VersionTimelineIllustration } from '../../shared/VersionTimelineIllustration';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipeVersionsTabProps {
  recipe: RecipeDefinition;
  onRecipeUpdated: (updated: RecipeDefinition) => void;
}

export function RecipeVersionsTab({ recipe, onRecipeUpdated }: RecipeVersionsTabProps) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<RecipeVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [requirements, setRequirements] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const versioning = useRecipeVersioning();

  const loadVersions = useCallback(async () => {
    try {
      const v = await recipeApi.getRecipeVersions(recipe.id);
      setVersions(v);
    } catch {
      useToastStore.getState().addToast('Failed to load recipe versions', 'error');
    } finally {
      setLoading(false);
    }
  }, [recipe.id]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    return () => versioning.reset();
  }, [recipe.id]);

  const handleGenerate = useCallback(async () => {
    if (!requirements.trim()) return;
    setError(null);
    setTerminalExpanded(false);
    await versioning.start(recipe.id, requirements.trim());
  }, [recipe.id, requirements, versioning]);

  const handleAccept = useCallback(async () => {
    if (!versioning.draft) return;
    setAccepting(true);
    setError(null);
    try {
      const draft = versioning.draft;
      const updated = await recipeApi.acceptRecipeVersion(
        recipe.id,
        draft.prompt_template,
        draft.input_schema ?? null,
        draft.sample_inputs ?? null,
        draft.description ?? null,
        draft.changes_summary ?? null,
      );
      onRecipeUpdated(updated);
      versioning.reset();
      setRequirements('');
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAccepting(false);
    }
  }, [versioning, recipe.id, onRecipeUpdated, loadVersions]);

  const handleRevert = useCallback(async (versionId: string) => {
    setReverting(versionId);
    setError(null);
    try {
      const updated = await recipeApi.revertRecipeVersion(recipe.id, versionId);
      onRecipeUpdated(updated);
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReverting(null);
    }
  }, [recipe.id, onRecipeUpdated, loadVersions]);

  return (
    <div className="flex flex-col h-full">
      {/* Generate Section */}
      <div className="p-4 border-b border-border/40 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Create New Version
        </h3>

        <div>
          <label className="block text-sm text-muted-foreground mb-1.5">
            {t.recipes.what_changes}
          </label>
          <textarea
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder="e.g., Add error handling for rate limits, include retry logic..."
            rows={3}
            className="w-full rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/50 resize-none"
          />
        </div>

        {/* Generate button */}
        {(versioning.phase === 'idle' || versioning.phase === 'error') && !versioning.draft && (
          <button
            onClick={handleGenerate}
            disabled={!requirements.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t.recipes.generate_new_version}
          </button>
        )}

        {/* Progress */}
        {versioning.phase === 'versioning' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RecipePageFlipLoader className="text-primary" />
              <span>{t.recipes.generating_version}</span>
            </div>
            <EstimatedProgressBar isRunning estimatedSeconds={30} />
            <TerminalStrip
              lastLine={versioning.lines[versioning.lines.length - 1] ?? 'Starting...'}
              lines={versioning.lines}
              isRunning
              isExpanded={terminalExpanded}
              onToggle={() => setTerminalExpanded((p) => !p)}
              expandedMaxHeight="max-h-48"
              operation="recipe_execution"
            />
          </div>
        )}

        {/* Error */}
        {(error || versioning.error) && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error || versioning.error}
          </div>
        )}

        {/* Draft Preview */}
        {versioning.draft && (
          <div className="rounded-lg border border-border/40 bg-card/50 p-4 space-y-3">
            {versioning.lines.length > 0 && (
              <TerminalStrip
                lastLine={versioning.lines[versioning.lines.length - 1] ?? ''}
                lines={versioning.lines}
                isRunning={false}
                isExpanded={terminalExpanded}
                onToggle={() => setTerminalExpanded((p) => !p)}
                onClear={() => setTerminalExpanded(false)}
                expandedMaxHeight="max-h-32"
              />
            )}

            <h4 className="text-sm font-semibold text-foreground/80">{t.recipes.generated_version}</h4>

            {versioning.draft.changes_summary && (
              <div>
                <p className="text-sm text-muted-foreground/60 mb-0.5">{t.recipes.changes}</p>
                <p className="text-sm text-foreground/80">{versioning.draft.changes_summary}</p>
              </div>
            )}

            <div>
              <p className="text-sm text-muted-foreground/60 mb-0.5">{t.recipes.updated_prompt}</p>
              <PromptTemplateRenderer content={versioning.draft.prompt_template} maxHeight="max-h-40" />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
              >
                {accepting ? <LoadingSpinner size="sm" /> : <Check className="w-3.5 h-3.5" />}
                {t.recipes.accept_apply}
              </button>
              <button
                onClick={() => {
                  versioning.reset();
                  handleGenerate();
                }}
                className="rounded-xl px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                Regenerate
              </button>
              <button
                onClick={() => versioning.reset()}
                className="rounded-xl px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>

      {/* {t.recipes.version_history} */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Version History {!loading && versions.length > 0 && `(${versions.length})`}
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
            <LoadingSpinner size="sm" /> {t.recipes.loading_versions}
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground/60 gap-2">
            <VersionTimelineIllustration />
            {t.recipes.no_versions}
          </div>
        ) : (
          <div className="relative">
            {/* Timeline connector line */}
            {versions.length > 1 && (
              <div className="absolute left-3 top-3 bottom-3 w-px bg-border/40" />
            )}

            <div className="space-y-2">
              {versions.map((version, idx) => {
                const isLatest = idx === 0;
                const isRevertTarget = reverting === version.id;

                return (
                  <div key={version.id} className="relative flex gap-3">
                    {/* Timeline node */}
                    <div className="relative z-10 flex-shrink-0 mt-3">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all ${
                          isLatest
                            ? 'bg-primary border-primary text-primary-foreground'
                            : isRevertTarget
                              ? 'bg-muted border-primary/30 text-muted-foreground ring-2 ring-primary/30 animate-pulse'
                              : 'bg-muted border-border/60 text-muted-foreground'
                        }`}
                      >
                        {version.version_number}
                      </div>
                    </div>

                    {/* Version card */}
                    <div className="flex-1 rounded-xl border border-border/40 bg-card/30 px-4 py-3 hover:border-border/60 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            v{version.version_number}
                          </span>
                          {isLatest && (
                            <span className="rounded-lg bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-sm text-primary font-medium">
                              Latest
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground/50">
                          {new Date(version.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      {version.description && (
                        <p className="text-sm text-foreground/70 mb-1">{version.description}</p>
                      )}

                      {version.changes_summary && (
                        <p className="text-sm text-muted-foreground/60 mb-2">{version.changes_summary}</p>
                      )}

                      {!isLatest && (
                        <button
                          onClick={() => handleRevert(version.id)}
                          disabled={isRevertTarget}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                        >
                          {isRevertTarget ? (
                            <LoadingSpinner size="xs" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          {t.recipes.revert_to_version}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
