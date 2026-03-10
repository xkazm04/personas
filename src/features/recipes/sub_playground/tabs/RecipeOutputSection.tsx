import { useCallback, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { EstimatedProgressBar } from '@/features/shared/components/progress/EstimatedProgressBar';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { formatOutputForMarkdown } from './recipeTestHelpers';

interface RecipeOutputSectionProps {
  result: { recipe_name: string; rendered_prompt: string; executed_at: string } | null;
  running: boolean;
  llmOutput: string | null;
  executionPhase: string;
  executionLines: string[];
  error: string | null;
  executionError: string | null;
}

export function RecipeOutputSection({
  result,
  running,
  llmOutput,
  executionPhase,
  executionLines,
  error,
  executionError,
}: RecipeOutputSectionProps) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  const handleCopyPrompt = useCallback(async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.rendered_prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  }, [result]);

  const handleCopyOutput = useCallback(async () => {
    if (!llmOutput) return;
    await navigator.clipboard.writeText(llmOutput);
    setCopiedOutput(true);
    setTimeout(() => setCopiedOutput(false), 2000);
  }, [llmOutput]);

  return (
    <>
      {/* Error */}
      {(error || executionError) && (
        <div className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error || executionError}
        </div>
      )}

      {/* Execution metadata */}
      {result && (
        <div className="mx-4 mt-3 flex items-center gap-3 text-sm text-muted-foreground/60">
          <span>Recipe: {result.recipe_name}</span>
          <span>Executed: {new Date(result.executed_at).toLocaleTimeString()}</span>
        </div>
      )}

      {/* Output Section - Two Columns */}
      <div className="flex-1 min-h-0 p-4 grid grid-cols-2 gap-4">
        {/* Left: Rendered Prompt */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Rendered Prompt
            </h3>
            {result && (
              <button
                onClick={handleCopyPrompt}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {copiedPrompt ? (
                  <><Check className="w-3 h-3 text-emerald-400" /> Copied</>
                ) : (
                  <><Copy className="w-3 h-3" /> Copy</>
                )}
              </button>
            )}
          </div>
          {result ? (
            <PromptTemplateRenderer content={result.rendered_prompt} maxHeight="max-h-[400px]" className="flex-1" />
          ) : (
            <div className="rounded-lg border border-border/40 bg-card/30 p-3 text-sm text-muted-foreground/50 flex-1">
              {running ? 'Rendering prompt...' : 'Run the recipe to see the rendered prompt.'}
            </div>
          )}
        </div>

        {/* Right: Execution Result */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Execution Result
            </h3>
            {llmOutput && (
              <button
                onClick={handleCopyOutput}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {copiedOutput ? (
                  <><Check className="w-3 h-3 text-emerald-400" /> Copied</>
                ) : (
                  <><Copy className="w-3 h-3" /> Copy</>
                )}
              </button>
            )}
          </div>

          {executionPhase === 'executing' ? (
            <div className="flex-1 space-y-2">
              <EstimatedProgressBar isRunning estimatedSeconds={30} />
              <TerminalStrip
                lastLine={executionLines[executionLines.length - 1] ?? 'Starting...'}
                lines={executionLines}
                isRunning
                isExpanded={terminalExpanded}
                onToggle={() => setTerminalExpanded((p) => !p)}
                expandedMaxHeight="max-h-48"
                operation="recipe_execution"
              />
            </div>
          ) : llmOutput ? (
            <div className="rounded-lg border border-border/40 bg-card/30 p-3 overflow-y-auto flex-1 max-h-[400px]">
              <MarkdownRenderer content={formatOutputForMarkdown(llmOutput)} />
            </div>
          ) : (
            <div className="rounded-lg border border-border/40 bg-card/30 p-3 text-sm text-muted-foreground/50 flex-1">
              {running ? 'Waiting for prompt render...' : 'Execute the recipe to see LLM output.'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
