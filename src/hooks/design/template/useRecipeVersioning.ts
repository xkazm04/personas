import { useCallback } from 'react';
import { useAiArtifactFlow, defaultGetLine, buildResolveStatus } from './useAiArtifactFlow';
import { startRecipeVersioning, cancelRecipeVersioning } from '@/api/templates/recipes';
import type { RecipeVersionDraft } from '@/lib/bindings/RecipeVersionDraft';

// ── Types ───────────────────────────────────────────────────────

export type RecipeVersioningPhase = 'idle' | 'versioning' | 'reviewing' | 'error';

interface RecipeVersioningInput {
  recipeId: string;
  changeRequirements: string;
}

// ── Hook ────────────────────────────────────────────────────────

export function useRecipeVersioning() {
  const flow = useAiArtifactFlow<RecipeVersioningInput, RecipeVersionDraft>({
    stream: {
      progressEvent: 'recipe-versioning-progress',
      statusEvent: 'recipe-versioning-status',
      getLine: defaultGetLine,
      resolveStatus: buildResolveStatus('Failed to generate recipe version'),
      completedPhase: 'reviewing',
      runningPhase: 'versioning',
      startErrorMessage: 'Failed to start recipe versioning',
    },
    startFn: ({ recipeId, changeRequirements }) =>
      startRecipeVersioning(recipeId, changeRequirements),
  });

  const start = useCallback(async (recipeId: string, changeRequirements: string) => {
    await flow.start({ recipeId, changeRequirements });
  }, [flow.start]);

  const cancel = useCallback(() => {
    flow.cancel(async () => { await cancelRecipeVersioning(); });
  }, [flow.cancel]);

  return {
    phase: flow.phase as RecipeVersioningPhase,
    lines: flow.lines,
    draft: flow.result,
    error: flow.error,
    start,
    cancel,
    reset: flow.reset,
  };
}
