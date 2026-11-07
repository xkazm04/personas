import { EngineCapabilityBadge } from '@/features/settings/sub_engine/components/EngineCapabilityBadge';
import { useTranslation } from '@/i18n/useTranslation';
import { Sparkles, X, Save } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
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
  const { t } = useTranslation();
  const sh = t.vault.shared;
  return (
    <div
        className="animate-fade-slide-in overflow-hidden"
      >
        <div className="rounded-modal border border-hair bg-primary/5 p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="typo-heading text-foreground flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              {sh.create_recipe}
            </h4>
            <Button
              onClick={onCancel}
              variant="ghost"
              size="icon-sm"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div>
            <label className="block typo-body text-foreground mb-1.5">
              {sh.recipe_what}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={sh.recipe_placeholder}
              rows={3}
              autoFocus
              className="w-full rounded-modal border border-border/50 bg-background/80 px-3 py-2 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50 resize-none"
            />
          </div>

          {/* Generate button */}
          {(generator.phase === 'idle' || generator.phase === 'error') && !generator.draft && (
            <Button
              onClick={onGenerate}
              disabled={!description.trim()}
              variant="primary"
              size="md"
              icon={<Sparkles className="w-3.5 h-3.5" />}
            >
              {sh.generate_with_ai}
            </Button>
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
                capabilityBadge={<EngineCapabilityBadge operation="recipe_execution" compact />}
              />
            </div>
          )}

          {/* Error */}
          {(error || generator.error) && (
            <div className="rounded-modal border border-status-error/30 bg-status-error/10 px-3 py-2 typo-body text-status-error">
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
                <h5 className="typo-heading text-foreground">{sh.generated_recipe}</h5>
                {generator.draft.category && (
                  <span className="rounded-card border border-border/40 bg-muted/20 px-2 py-0.5 typo-body text-foreground">
                    {generator.draft.category}
                  </span>
                )}
              </div>

              <div>
                <p className="typo-body text-foreground mb-0.5">{sh.name_label}</p>
                <p className="typo-body text-foreground">{generator.draft.name}</p>
              </div>

              {generator.draft.description && (
                <div>
                  <p className="typo-body text-foreground mb-0.5">{sh.description_label}</p>
                  <p className="typo-body text-foreground">{generator.draft.description}</p>
                </div>
              )}

              <div>
                <p className="typo-body text-foreground mb-0.5">{sh.prompt_template}</p>
                <PromptTemplateRenderer content={generator.draft.prompt_template} maxHeight="max-h-40" />
              </div>

              {generator.draft.example_result && (
                <div>
                  <p className="typo-body text-foreground mb-0.5">{sh.example_result}</p>
                  <pre className="rounded-card border border-hair bg-surface-1 p-3 typo-code text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {generator.draft.example_result}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="accent"
                  tone="success"
                  size="sm"
                  icon={<Save className="w-3.5 h-3.5" />}
                  onClick={onSaveDraft}
                  loading={saving}
                >
                  {sh.accept_save}
                </Button>
                <Button
                  onClick={() => {
                    generator.reset();
                    onGenerate();
                  }}
                  variant="ghost"
                  size="sm"
                >
                  {sh.regenerate}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
