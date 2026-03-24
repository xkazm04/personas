import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { startRecipeVersioning, cancelRecipeVersioning } from '@/api/templates/recipes';
import { EventName } from '@/lib/eventRegistry';
import type { RecipeVersionDraft } from '@/lib/bindings/RecipeVersionDraft';

// -- Types -------------------------------------------------------

export type RecipeVersioningPhase = 'idle' | 'versioning' | 'reviewing' | 'error';

// -- Hook --------------------------------------------------------

export function useRecipeVersioning() {
  const task = useAiArtifactTask<[string, string], RecipeVersionDraft>({
    progressEvent: 'recipe-versioning-progress',
    statusEvent: EventName.RECIPE_VERSIONING_STATUS,
    runningPhase: 'versioning',
    completedPhase: 'reviewing',
    startFn: startRecipeVersioning,
    cancelFn: cancelRecipeVersioning,
    errorMessage: 'Failed to generate recipe version',
    traceOperation: 'recipe_execution',
  });

  return {
    phase: task.phase as RecipeVersioningPhase,
    lines: task.lines,
    draft: task.result,
    error: task.error,
    start: task.start,
    cancel: task.cancel,
    reset: task.reset,
  };
}
