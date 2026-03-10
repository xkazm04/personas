import { useState, useCallback, useMemo } from 'react';
import { Play, Loader2, Copy, Check, Download, Save, Database } from 'lucide-react';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { EstimatedProgressBar } from '@/features/shared/components/progress/EstimatedProgressBar';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { updateRecipe } from '@/api/templates/recipes';
import { useRecipeTestRunner } from '../libs/useRecipeTestRunner';

interface RecipeTestRunnerTabProps {
  recipe: RecipeDefinition;
}

interface InputField {
  key: string;
  type: string;
  label: string;
  default?: unknown;
  options?: string[];
}

function parseInputSchema(schema: string | null): InputField[] {
  if (!schema) return [];
  try {
    const parsed = JSON.parse(schema);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // intentional: non-critical â€” JSON parse fallback
    return [];
  }
}

function parseMockValues(sampleInputs: string | null): Record<string, unknown> | null {
  if (!sampleInputs) return null;
  try {
    const parsed = JSON.parse(sampleInputs);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    // intentional: non-critical â€” JSON parse fallback
    return null;
  }
}

function formatOutputForMarkdown(output: string): string {
  // If it looks like JSON, wrap in a fenced block for syntax highlighting
  const trimmed = output.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const formatted = JSON.stringify(JSON.parse(trimmed), null, 2);
      return '```json\n' + formatted + '\n```';
    } catch {
      // intentional: non-critical â€” JSON parse fallback
    }
  }
  return trimmed;
}

export function RecipeTestRunnerTab({ recipe }: RecipeTestRunnerTabProps) {
  const fields = useMemo(() => parseInputSchema(recipe.input_schema), [recipe.input_schema]);
  const mockValues = useMemo(() => parseMockValues(recipe.sample_inputs), [recipe.sample_inputs]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const f of fields) {
      defaults[f.key] = String(f.default ?? '');
    }
    return defaults;
  });
  const [freeInput, setFreeInput] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [mockSaved, setMockSaved] = useState(false);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  const {
    running, result, error, execute,
    executionPhase, executionLines, llmOutput, executionError,
  } = useRecipeTestRunner(recipe);

  const handleLoadMockValues = useCallback(() => {
    if (!recipe.sample_inputs) return;
    try {
      const mock = JSON.parse(recipe.sample_inputs) as Record<string, string>;
      setFieldValues((prev) => ({ ...prev, ...mock }));
    } catch {
      // intentional: non-critical â€” JSON parse fallback
    }
  }, [recipe.sample_inputs]);

  const handleSaveMockValues = useCallback(async () => {
    const mockJson = JSON.stringify(fieldValues);
    await updateRecipe(recipe.id, {
      name: null, description: null, category: null, prompt_template: null,
      input_schema: null, output_contract: null, tool_requirements: null,
      credential_requirements: null, model_preference: null,
      sample_inputs: mockJson, tags: null, icon: null, color: null,
    });
    setMockSaved(true);
    setTimeout(() => setMockSaved(false), 2000);
  }, [fieldValues, recipe.id]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleExecute = useCallback(async () => {
    let inputData: Record<string, unknown>;
    if (fields.length > 0) {
      inputData = { ...fieldValues };
    } else if (freeInput.trim()) {
      try {
        inputData = JSON.parse(freeInput);
      } catch {
        // intentional: non-critical â€” JSON parse fallback
        inputData = { input: freeInput };
      }
    } else {
      inputData = {};
    }
    setTerminalExpanded(false);
    await execute(inputData);
  }, [fields, fieldValues, freeInput, execute]);

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
    <div className="flex flex-col h-full">
      {/* Input Section */}
      <div className="p-4 border-b border-border/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Input
          </h3>
          <div className="flex items-center gap-2">
            {recipe.sample_inputs && fields.length > 0 && (
              <button
                onClick={handleLoadMockValues}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-primary hover:bg-primary/10 transition-colors"
              >
                <Download className="w-3 h-3" /> Load Mock
              </button>
            )}
            {fields.length > 0 && (
              <button
                onClick={handleSaveMockValues}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                {mockSaved ? (
                  <><Check className="w-3 h-3 text-emerald-400" /> Saved</>
                ) : (
                  <><Save className="w-3 h-3" /> Save Mock</>
                )}
              </button>
            )}
            <button
              onClick={handleExecute}
              disabled={running || executionPhase === 'executing'}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {running || executionPhase === 'executing' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {running ? 'Rendering...' : executionPhase === 'executing' ? 'Executing...' : 'Execute'}
            </button>
          </div>
        </div>

        {/* Two-column: Test Input | Mock Values */}
        <div className="grid grid-cols-2 gap-4">
          {/* Left: Test Input */}
          <div>
            <p className="text-sm font-medium text-muted-foreground/70 mb-2">Test Input</p>
            {fields.length > 0 ? (
              <div className="space-y-2.5">
                {fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm text-muted-foreground mb-1">
                      {field.label || field.key}
                      <span className="ml-1 text-sm text-muted-foreground/50">({field.type})</span>
                    </label>
                    {field.type === 'select' && field.options ? (
                      <select
                        value={fieldValues[field.key] ?? ''}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-emerald-500/50"
                      >
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : field.type === 'boolean' ? (
                      <div className="flex gap-2">
                        {['true', 'false'].map((v) => (
                          <button
                            key={v}
                            onClick={() => handleFieldChange(field.key, v)}
                            className={`rounded-xl px-3 py-1 text-sm border transition-colors ${
                              fieldValues[field.key] === v
                                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                                : 'border-border/60 text-muted-foreground hover:border-border'
                            }`}
                          >
                            {v === 'true' ? 'Yes' : 'No'}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={fieldValues[field.key] ?? ''}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-emerald-500/50"
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <textarea
                value={freeInput}
                onChange={(e) => setFreeInput(e.target.value)}
                placeholder="Enter input JSON or plain text..."
                rows={3}
                className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-emerald-500/50 resize-y"
              />
            )}
          </div>

          {/* Right: Saved Mock Values */}
          <div>
            <p className="text-sm font-medium text-muted-foreground/70 mb-2">Saved Mock Values</p>
            <div className="rounded-lg border border-border/40 bg-card/30 p-3 max-h-60 overflow-y-auto">
              {mockValues ? (
                <div className="space-y-1.5">
                  {Object.entries(mockValues).map(([key, value]) => (
                    <div key={key} className="flex items-baseline gap-2 text-sm">
                      <span className="text-muted-foreground/70 font-mono shrink-0">{key}:</span>
                      <span className="text-foreground/70 font-mono break-all">
                        {typeof value === 'string' ? `"${value}"` : JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
                  <Database className="w-3.5 h-3.5" />
                  No mock values saved
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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

      {/* Output Section â€” Two Columns */}
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
    </div>
  );
}
