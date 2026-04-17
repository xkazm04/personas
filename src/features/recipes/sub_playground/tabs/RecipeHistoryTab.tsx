import { Clock, Trash2 } from 'lucide-react';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { RecipeExecutionResult } from '@/lib/bindings/RecipeExecutionResult';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipeHistoryTabProps {
  history: RecipeExecutionResult[];
  onClear: () => void;
}

export function RecipeHistoryTab({ history, onClear }: RecipeHistoryTabProps) {
  const { t } = useTranslation();
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full typo-body text-foreground gap-2">
        <Clock className="w-5 h-5" />
        {t.recipes.no_executions}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="typo-heading font-semibold text-foreground uppercase tracking-wide">
          Recent Runs ({history.length})
        </h3>
        <button
          onClick={onClear}
          className="flex items-center gap-1 typo-body text-foreground hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" /> {t.common.clear}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {history.map((run, idx) => (
          <div
            key={`${run.executed_at}-${idx}`}
            className="rounded-card border border-border/40 bg-card/30 overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-muted/10">
              <span className="typo-body text-foreground">
                {new Date(run.executed_at).toLocaleString()}
              </span>
              <span className="typo-body text-foreground">
                {Object.keys(run.input_data).length} input{Object.keys(run.input_data).length !== 1 ? 's' : ''}
              </span>
            </div>
            {Object.keys(run.input_data).length > 0 && (
              <div className="px-3 py-2 border-b border-border/20">
                <p className="typo-body text-foreground mb-1">Input</p>
                <pre className="typo-code font-mono text-foreground whitespace-pre-wrap">
                  {JSON.stringify(run.input_data, null, 2)}
                </pre>
              </div>
            )}
            <div className="px-3 py-2">
              <p className="typo-body text-foreground mb-1">Rendered Prompt</p>
              <PromptTemplateRenderer content={run.rendered_prompt} maxHeight="max-h-40" />
            </div>
            {run.llm_output && (
              <div className="px-3 py-2 border-t border-border/20">
                <p className="typo-body text-foreground mb-1">LLM Output</p>
                <div className="rounded-card border border-border/40 bg-card/30 p-3 max-h-40 overflow-y-auto">
                  <MarkdownRenderer content={
                    (() => {
                      const trimmed = run.llm_output!.trim();
                      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        try { return '```json\n' + JSON.stringify(JSON.parse(trimmed), null, 2) + '\n```'; } catch { /* intentional: non-critical -- JSON parse fallback */ }
                      }
                      return trimmed;
                    })()
                  } />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
