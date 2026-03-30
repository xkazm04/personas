import { useMemo } from 'react';
import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { startRecipeExecution, cancelRecipeExecution } from '@/api/templates/recipes';
import { EventName } from '@/lib/eventRegistry';

// -- Types -------------------------------------------------------

export type RecipeExecutionPhase = 'idle' | 'executing' | 'done' | 'error';

interface RecipeExecutionOutput {
  output: string;
}

// -- Hook --------------------------------------------------------

export function useRecipeExecution() {
  const task = useAiArtifactTask<[string, Record<string, unknown>], RecipeExecutionOutput>({
    progressEvent: 'recipe-execution-progress',
    statusEvent: EventName.RECIPE_EXECUTION_STATUS,
    runningPhase: 'executing',
    completedPhase: 'done',
    startFn: startRecipeExecution,
    cancelFn: cancelRecipeExecution,
    errorMessage: 'Failed to execute recipe',
    traceOperation: 'recipe_execution',
  });

  const output = task.result?.output ?? null;

  return useMemo(() => ({
    phase: task.phase as RecipeExecutionPhase,
    lines: task.lines,
    output,
    error: task.error,
    start: task.start,
    cancel: task.cancel,
    reset: task.reset,
  }), [task.phase, task.lines, output, task.error, task.start, task.cancel, task.reset]);
}
