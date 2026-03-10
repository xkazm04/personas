import { useState, useCallback, useRef, useEffect } from 'react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import type { RecipeExecutionResult } from '@/lib/bindings/RecipeExecutionResult';
import { useRecipeExecution } from '@/hooks/design/template/useRecipeExecution';
import * as api from '@/api/templates/recipes';

export function useRecipeTestRunner(recipe: RecipeDefinition) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RecipeExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RecipeExecutionResult[]>([]);
  const runCountRef = useRef(0);

  const execution = useRecipeExecution();

  // When LLM execution completes, store output on the result and add to history
  useEffect(() => {
    if (execution.phase === 'done' && execution.output && result) {
      const updated = { ...result, llm_output: execution.output };
      setResult(updated);
      setHistory((prev) => {
        const [, ...rest] = prev; // remove the preliminary entry
        return [updated, ...rest].slice(0, 20);
      });
    }
  }, [execution.phase, execution.output]);

  const execute = useCallback(async (inputData: Record<string, unknown>) => {
    const runId = ++runCountRef.current;
    setRunning(true);
    setError(null);
    setResult(null);
    execution.reset();

    try {
      // Step 1: Render the prompt template (synchronous backend call)
      const res = await api.executeRecipe({
        recipe_id: recipe.id,
        input_data: inputData,
      });
      if (runId !== runCountRef.current) return;
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
