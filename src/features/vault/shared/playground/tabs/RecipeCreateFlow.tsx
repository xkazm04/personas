import { Sparkles, X, Save } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { EstimatedProgressBar } from '@/features/shared/components/progress/EstimatedProgressBar';
import type { useRecipeGenerator } from '@/hooks/design/template/useRecipeGenerator';

interface RecipeCreateFlowProps {
  description: string;
  setDescription: (v: string) => void;
  generator: ReturnType<typeof useRecipeGenerator>;
  error: string | null;
  saving: boolean;
  terminalExpanded: boolean;
  setTerminalExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  onGenerate: () => void;
  onSaveDraft: () => void;
  onCancel: () => void;
}

export function RecipeCreateFlow({
  description,
  setDescription,
  generator,
  error,
  saving,
  terminalExpanded,
  setTerminalExpanded,
  onGenerate,
  onSaveDraft,
  onCancel,
}: RecipeCreateFlowProps) {
  return (
    <div
        className="animate-fade-slide-in overflow-hidden"
      >
        <div className="rounded-modal border border-primary/10 bg-primary/5 p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="typo-heading font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Create Recipe
            </h4>
            <button
              onClick={onCancel}
              className="p-1 rounded-card text-foreground hover:text-foreground/80 hover:bg-muted/30 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div>
            <label className="block typo-body text-foreground mb-1.5">
              What should this recipe do?
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., List all open pull requests for a repository and summarize the changes..."
              rows={3}
              autoFocus
              className="w-full rounded-modal border border-border/50 bg-background/80 px-3 py-2 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50 resize-none"
            />
          </div>

          {/* Generate button */}
          {(generator.phase === 'idle' || generator.phase === 'error') && !generator.draft && (
            <button
              onClick={onGenerate}
              disabled={!description.trim()}
              className="flex items-center gap-1.5 rounded-modal bg-primary px-4 py-2 typo-body font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate with AI
            </button>
          )}

          {/* Progress + Terminal strip */}
          {generator.phase === 'generating' && (
            <div className="space-y-2">
              <EstimatedProgressBar key={`progress-${generator.phase}`} isRunning={generator.phase === 'generating'} estimatedSeconds={30} />
              <TerminalStrip
                lastLine={generator.lines[generator.lines.length - 1] ?? 'Starting...'}
                lines={generator.lines}
                isRunning
                isExpanded={terminalExpanded}
                onToggle={() => setTerminalExpanded((p) => !p)}
                expandedMaxHeight="max-h-48"
                operation="recipe_execution"
              />
            </div>
          )}

          {/* Error */}
          {(error || generator.error) && (
            <div className="rounded-modal border border-red-500/30 bg-red-500/10 px-3 py-2 typo-body text-red-400">
              {error || generator.error}
            </div>
          )}

          {/* Draft Preview */}
          {generator.draft && (
            <div className="rounded-card border border-border/40 bg-card/50 p-4 space-y-3">
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
                <h5 className="typo-heading font-semibold text-foreground">Generated Recipe</h5>
                {generator.draft.category && (
                  <span className="rounded-card border border-border/40 bg-muted/20 px-2 py-0.5 typo-body text-foreground">
                    {generator.draft.category}
                  </span>
                )}
              </div>

              <div>
                <p className="typo-body text-foreground mb-0.5">Name</p>
                <p className="typo-body text-foreground">{generator.draft.name}</p>
              </div>

              {generator.draft.description && (
                <div>
                  <p className="typo-body text-foreground mb-0.5">Description</p>
                  <p className="typo-body text-foreground">{generator.draft.description}</p>
                </div>
              )}

              <div>
                <p className="typo-body text-foreground mb-0.5">Prompt Template</p>
                <PromptTemplateRenderer content={generator.draft.prompt_template} maxHeight="max-h-40" />
              </div>

              {generator.draft.example_result && (
                <div>
                  <p className="typo-body text-foreground mb-0.5">Example Result</p>
                  <pre className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-3 typo-code font-mono text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {generator.draft.example_result}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onSaveDraft}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-modal bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 typo-body font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                >
                  {saving ? <LoadingSpinner size="sm" /> : <Save className="w-3.5 h-3.5" />}
                  Accept & Save
                </button>
                <button
                  onClick={() => {
                    generator.reset();
                    onGenerate();
                  }}
                  className="rounded-modal px-3 py-1.5 typo-body text-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                >
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
