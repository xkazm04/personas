import { useCallback } from 'react';
import { useAiArtifactFlow, defaultGetLine, buildResolveStatus } from './useAiArtifactFlow';
import { startRecipeExecution, cancelRecipeExecution } from '@/api/recipes';

// ── Types ───────────────────────────────────────────────────────

export type RecipeExecutionPhase = 'idle' | 'executing' | 'done' | 'error';

interface RecipeExecutionInput {
  recipeId: string;
  inputData: Record<string, unknown>;
}

interface RecipeExecutionOutput {
  output: string;
}

// ── Hook ────────────────────────────────────────────────────────

export function useRecipeExecution() {
  const flow = useAiArtifactFlow<RecipeExecutionInput, RecipeExecutionOutput>({
    stream: {
      progressEvent: 'recipe-execution-progress',
      statusEvent: 'recipe-execution-status',
      getLine: defaultGetLine,
      resolveStatus: buildResolveStatus('Failed to execute recipe'),
      completedPhase: 'done',
      runningPhase: 'executing',
      startErrorMessage: 'Failed to start recipe execution',
    },
    startFn: ({ recipeId, inputData }) =>
      startRecipeExecution(recipeId, inputData),
  });

  const start = useCallback(async (recipeId: string, inputData: Record<string, unknown>) => {
    await flow.start({ recipeId, inputData });
  }, [flow.start]);

  const cancel = useCallback(() => {
    flow.cancel(async () => { await cancelRecipeExecution(); });
  }, [flow.cancel]);

  return {
    phase: flow.phase as RecipeExecutionPhase,
    lines: flow.lines,
    output: flow.result?.output ?? null,
    error: flow.error,
    start,
    cancel,
    reset: flow.reset,
  };
}
