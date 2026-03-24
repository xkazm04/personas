import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { startRecipeGeneration, cancelRecipeGeneration } from '@/api/templates/recipes';
import { EventName } from '@/lib/eventRegistry';
import type { RecipeDraft } from '@/lib/bindings/RecipeDraft';

// -- Types -------------------------------------------------------

export type RecipeGeneratorPhase = 'idle' | 'generating' | 'reviewing' | 'error';

// -- Hook --------------------------------------------------------

export function useRecipeGenerator() {
  const task = useAiArtifactTask<[string, string], RecipeDraft>({
    progressEvent: 'recipe-generation-progress',
    statusEvent: EventName.RECIPE_GENERATION_STATUS,
    runningPhase: 'generating',
    completedPhase: 'reviewing',
    startFn: startRecipeGeneration,
    cancelFn: cancelRecipeGeneration,
    errorMessage: 'Failed to generate recipe',
    traceOperation: 'recipe_execution',
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
