import { useMemo } from 'react';
import { useAiArtifactTask } from '../core/useAiArtifactTask';
import { startRecipeVersioning, cancelRecipeVersioning } from '@/api/recipes/recipes';
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
    // The backend job's id_field and timeout_secs, from recipes/recipe_versioning.rs RECIPE_VERSIONING_MESSAGES; artifactDeadlineParity.test.ts fails if they differ.
    idField: 'versioning_id',
    backendTimeoutSecs: 300,
    errorMessage: 'Failed to generate recipe version',
    traceOperation: 'recipe_versioning',
  });

  return useMemo(() => ({
    phase: task.phase as RecipeVersioningPhase,
    lines: task.lines,
    draft: task.result,
    error: task.error,
    start: task.start,
    cancel: task.cancel,
    reset: task.reset,
  }), [task.phase, task.lines, task.result, task.error, task.start, task.cancel, task.reset]);
}
