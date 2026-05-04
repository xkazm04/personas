import { useState, useCallback, useRef, useEffect } from 'react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { RecipeExecutionResult } from '@/lib/bindings/RecipeExecutionResult';
import { useRecipeExecution } from '@/hooks/design/template/useRecipeExecution';
import * as api from '@/api/recipes/recipes';

export function useRecipeTestRunner(recipe: RecipeDefinition) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RecipeExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RecipeExecutionResult[]>([]);
  const runCountRef = useRef(0);
  // Tracks which run produced the current `result`. When a late-arriving
  // execution.output fires the merge effect, we compare against this so we
  // don't scribble run #1's LLM output onto run #2's result. Without this,
  // switching recipes mid-flight (or starting a second run before the first
  // completed) would conflate llm_output with the wrong rendered_prompt and
  // corrupt the history entry.
  const resultRunIdRef = useRef<number>(0);

  const execution = useRecipeExecution();

  // When LLM execution completes, store output on the result and add to history.
  // Gated by run-id correlation: only merge if the current `result` was produced
  // by the same run that this execution.output belongs to (i.e. no newer run
  // has been started since).
  useEffect(() => {
    if (execution.phase === 'done' && execution.output && result &&
        resultRunIdRef.current === runCountRef.current) {
      const updated = { ...result, llm_output: execution.output };
      setResult(updated);
      setHistory((prev) => {
        const [, ...rest] = prev; // remove the preliminary entry
        return [updated, ...rest].slice(0, 20);
      });
    }
  }, [execution.phase, execution.output, result]);

  const execute = useCallback(async (inputData: Record<string, unknown>) => {
    const runId = ++runCountRef.current;
    setRunning(true);
    setError(null);
    setResult(null);
    resultRunIdRef.current = 0; // invalidate prior result's run-id binding
    execution.reset();

    try {
      // Step 1: Render the prompt template (synchronous backend call)
      const res = await api.executeRecipe({
        recipe_id: recipe.id,
        input_data: inputData as Parameters<typeof api.executeRecipe>[0]['input_data'],
      });
      if (runId !== runCountRef.current) return;
      resultRunIdRef.current = runId;
      setResult(res);
      setHistory((prev) => [res, ...prev].slice(0, 20));

      // Step 2: Fire the LLM CLI for actual execution
      await execution.start(recipe.id, inputData);
    } catch (err) {
      if (runId !== runCountRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (runId === runCountRef.current) setRunning(false);
    }
  }, [recipe.id, execution]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    running,
    result,
    error,
    history,
    execute,
    clearHistory,
    // LLM execution state
    executionPhase: execution.phase,
    executionLines: execution.lines,
    llmOutput: execution.output,
    executionError: execution.error,
    cancelExecution: execution.cancel,
  };
}
