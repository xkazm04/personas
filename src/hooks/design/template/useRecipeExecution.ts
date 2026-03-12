import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { startRecipeExecution, cancelRecipeExecution } from '@/api/templates/recipes';

// -- Types -------------------------------------------------------

export type RecipeExecutionPhase = 'idle' | 'executing' | 'done' | 'error';

interface RecipeExecutionOutput {
  output: string;
}

// -- Hook --------------------------------------------------------

export function useRecipeExecution() {
  const task = useAiArtifactTask<[string, Record<string, unknown>], RecipeExecutionOutput>({
    progressEvent: 'recipe-execution-progress',
    statusEvent: 'recipe-execution-status',
    runningPhase: 'executing',
    completedPhase: 'done',
    startFn: startRecipeExecution,
    cancelFn: cancelRecipeExecution,
    errorMessage: 'Failed to execute recipe',
  });

  return {
    phase: task.phase as RecipeExecutionPhase,
    lines: task.lines,
    output: task.result?.output ?? null,
    error: task.error,
    start: task.start,
    cancel: task.cancel,
    reset: task.reset,
  };
}
