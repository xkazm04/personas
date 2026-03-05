import { useCallback } from 'react';
import { useAiArtifactFlow, defaultGetLine, buildResolveStatus } from './useAiArtifactFlow';
import { startRecipeGeneration, cancelRecipeGeneration } from '@/api/recipes';
import type { RecipeDraft } from '@/lib/bindings/RecipeDraft';

// ── Types ───────────────────────────────────────────────────────

export type RecipeGeneratorPhase = 'idle' | 'generating' | 'reviewing' | 'error';

interface RecipeGenerationInput {
  credentialId: string;
  description: string;
}

// ── Hook ────────────────────────────────────────────────────────

export function useRecipeGenerator() {
  const flow = useAiArtifactFlow<RecipeGenerationInput, RecipeDraft>({
    stream: {
      progressEvent: 'recipe-generation-progress',
      statusEvent: 'recipe-generation-status',
      getLine: defaultGetLine,
      resolveStatus: buildResolveStatus('Failed to generate recipe'),
      completedPhase: 'reviewing',
      runningPhase: 'generating',
      startErrorMessage: 'Failed to start recipe generation',
    },
    startFn: ({ credentialId, description }) =>
      startRecipeGeneration(credentialId, description),
  });

  const start = useCallback(async (credentialId: string, description: string) => {
    await flow.start({ credentialId, description });
  }, [flow.start]);

  const cancel = useCallback(() => {
    flow.cancel(async () => { await cancelRecipeGeneration(); });
  }, [flow.cancel]);

  return {
    phase: flow.phase as RecipeGeneratorPhase,
    lines: flow.lines,
    draft: flow.result,
    error: flow.error,
    start,
    cancel,
    reset: flow.reset,
  };
}
