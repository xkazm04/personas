import { Clock, Trash2 } from 'lucide-react';
import { PromptTemplateRenderer } from '@/features/shared/components/PromptTemplateRenderer';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';
import type { RecipeExecutionResult } from '@/lib/bindings/RecipeExecutionResult';

interface RecipeHistoryTabProps {
  history: RecipeExecutionResult[];
  onClear: () => void;
}

export function RecipeHistoryTab({ history, onClear }: RecipeHistoryTabProps) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-muted-foreground/60 gap-2">
        <Clock className="w-5 h-5" />
        No executions yet. Run the recipe in the Test Runner tab.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent Runs ({history.length})
        </h3>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {history.map((run, idx) => (
          <div
            key={`${run.executed_at}-${idx}`}
            className="rounded-lg border border-border/40 bg-card/30 overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-muted/10">
              <span className="text-sm text-muted-foreground">
                {new Date(run.executed_at).toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground/60">
                {Object.keys(run.input_data).length} input{Object.keys(run.input_data).length !== 1 ? 's' : ''}
              </span>
            </div>
            {Object.keys(run.input_data).length > 0 && (
              <div className="px-3 py-2 border-b border-border/20">
                <p className="text-sm text-muted-foreground/60 mb-1">Input</p>
                <pre className="text-sm font-mono text-foreground/70 whitespace-pre-wrap">
                  {JSON.stringify(run.input_data, null, 2)}
                </pre>
              </div>
            )}
            <div className="px-3 py-2">
              <p className="text-sm text-muted-foreground/60 mb-1">Rendered Prompt</p>
              <PromptTemplateRenderer content={run.rendered_prompt} maxHeight="max-h-40" />
            </div>
            {run.llm_output && (
              <div className="px-3 py-2 border-t border-border/20">
                <p className="text-sm text-muted-foreground/60 mb-1">LLM Output</p>
                <div className="rounded-lg border border-border/40 bg-card/30 p-3 max-h-40 overflow-y-auto">
                  <MarkdownRenderer content={
                    (() => {
                      const trimmed = run.llm_output!.trim();
                      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        try { return '```json\n' + JSON.stringify(JSON.parse(trimmed), null, 2) + '\n```'; } catch { /* intentional: non-critical — JSON parse fallback */ }
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
