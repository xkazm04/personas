import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { startRecipeGeneration, cancelRecipeGeneration } from '@/api/templates/recipes';
import type { RecipeDraft } from '@/lib/bindings/RecipeDraft';

// -- Types -------------------------------------------------------

export type RecipeGeneratorPhase = 'idle' | 'generating' | 'reviewing' | 'error';

// -- Hook --------------------------------------------------------

export function useRecipeGenerator() {
  const task = useAiArtifactTask<[string, string], RecipeDraft>({
    progressEvent: 'recipe-generation-progress',
    statusEvent: 'recipe-generation-status',
    runningPhase: 'generating',
    completedPhase: 'reviewing',
    startFn: startRecipeGeneration,
    cancelFn: cancelRecipeGeneration,
    errorMessage: 'Failed to generate recipe',
  });

  return {
    phase: task.phase as RecipeGeneratorPhase,
    lines: task.lines,
    draft: task.result,
    error: task.error,
    start: task.start,
    cancel: task.cancel,
    reset: task.reset,
  };
}
