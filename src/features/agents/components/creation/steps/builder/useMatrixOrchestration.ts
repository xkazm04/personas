/**
 * useMatrixOrchestration — AI generation + credential matching + dry-run for Matrix creation mode.
 * Adapts useBuilderOrchestration for the matrix-centric flow.
 */
import { useState, useEffect, useCallback, useRef, type Dispatch } from 'react';
import type { BuilderState } from './types';
import type { BuilderAction } from './builderReducer';
import { useDesignAnalysis } from '@/hooks/design/core/useDesignAnalysis';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { useDryRun } from './useDryRun';

interface UseMatrixOrchestrationArgs {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  draftPersonaId: string | null;
  setDraftPersonaId: (id: string | null) => void;
}

/** Compute completeness 0-100 from BuilderState. */
export function calcCompleteness(state: BuilderState): number {
  let filled = 0;
  const total = 8;
  // Use cases
  if (state.useCases.some((uc) => uc.title.trim())) filled++;
  // Components (connectors)
  if (state.components.length > 1) filled++; // >1 because default notify always present
  // Triggers
  if (state.globalTrigger) filled++;
  // Review policy
  if (state.reviewPolicy !== 'never') filled++;
  // Error strategy
  if (state.errorStrategy !== 'halt') filled++;
  // Intent (identity/prompt)
  if (state.intent.trim().length > 10) filled++;
  // Channels (messages)
  if (state.channels.length > 0) filled++;
  // Memory (always on by default — count as filled)
  filled++;
  return Math.round((filled / total) * 100);
}

export function useMatrixOrchestration({
  state,
  dispatch,
  draftPersonaId,
  setDraftPersonaId,
}: UseMatrixOrchestrationArgs) {
  const createPersona = usePersonaStore((s) => s.createPersona);
  const createGroup = usePersonaStore((s) => s.createGroup);
  const movePersonaToGroup = usePersonaStore((s) => s.movePersonaToGroup);
  const design = useDesignAnalysis();
  const [isGenerating, setIsGenerating] = useState(false);
  const isCreatingRef = useRef(false);
  const dryRun = useDryRun();
  const [autoTestGen, setAutoTestGen] = useState(0);

  const hasIntent = state.intent.trim().length > 0;
  const canGenerate = hasIntent && !isGenerating;
  const hasDesignResult = !!design.result;
  const completeness = calcCompleteness(state);

  // Watch for design result and apply to builder
  useEffect(() => {
    if (design.phase === 'preview' && design.result && isGenerating) {
      dispatch({ type: 'APPLY_DESIGN_RESULT', payload: design.result });
      // Auto-match credentials from vault
      const creds = usePersonaStore.getState().credentials;
      dispatch({ type: 'AUTO_MATCH_CREDENTIALS', payload: { credentials: creds.map((c) => ({ id: c.id, service_type: c.service_type })) } });
      setIsGenerating(false);
      // Trigger silent dry run
      setAutoTestGen((g) => g + 1);
    }
    if (design.error && isGenerating) {
      setIsGenerating(false);
    }
  }, [design.phase, design.result, design.error, isGenerating, dispatch]);

  // Auto-run dry run after generation
  useEffect(() => {
    if (autoTestGen > 0 && dryRun.phase === 'idle') {
      dryRun.runTest(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTestGen]);

  // Auto-apply all fixable proposals
  useEffect(() => {
    if (dryRun.phase === 'done' && dryRun.result) {
      for (const issue of dryRun.result.issues) {
        if (issue.proposal && !issue.resolved) {
          for (const action of issue.proposal.actions) {
            dispatch(action);
          }
          dryRun.markIssueResolved(issue.id);
        }
      }
    }
  }, [dryRun.phase, dryRun.result, dispatch, dryRun]);

  useEffect(() => {
    if (draftPersonaId) isCreatingRef.current = false;
  }, [draftPersonaId]);

  useEffect(() => {
    if (!isGenerating) isCreatingRef.current = false;
  }, [isGenerating]);

  const handleGenerate = useCallback(async () => {
    if (isCreatingRef.current || !canGenerate) return;
    isCreatingRef.current = true;
    setIsGenerating(true);

    try {
      let personaId = draftPersonaId;
      if (!personaId) {
        const name = state.intent.trim().slice(0, 30) || 'Draft Agent';
        const persona = await createPersona({
          name,
          description: state.intent.trim().slice(0, 200) || undefined,
          system_prompt: 'You are a helpful AI assistant.',
        });
        personaId = persona.id;
        setDraftPersonaId(personaId);

        try {
          const groups = usePersonaStore.getState().groups;
          let draftGroup = groups.find((g) => g.name === 'Draft');
          if (!draftGroup) {
            draftGroup = await createGroup({ name: 'Draft', color: '#6B7280', description: 'Agents being designed' }) ?? undefined;
          }
          if (draftGroup) {
            await movePersonaToGroup(personaId, draftGroup.id);
          }
        } catch {
          // intentional: non-critical
        }
      }

      // Build enhanced intent with component names
      let enhancedIntent = state.intent.trim();
      if (state.components.length > 0) {
        const byRole: Record<string, string[]> = {};
        for (const c of state.components) {
          (byRole[c.role] ??= []).push(c.connectorName);
        }
        const parts = Object.entries(byRole).map(([role, names]) => `${role}: ${names.join(', ')}`);
        enhancedIntent += `\nComponents: ${parts.join('; ')}`;
      }

      await design.startIntentCompilation(personaId, enhancedIntent);
    } catch {
      useToastStore.getState().addToast('Failed to generate agent — check your connection', 'error');
      isCreatingRef.current = false;
      setIsGenerating(false);
    }
  }, [canGenerate, draftPersonaId, state.intent, state.components, createPersona, createGroup, movePersonaToGroup, setDraftPersonaId, design]);

  const handleRefine = useCallback(async (feedback: string) => {
    if (!feedback.trim() || !design.result || isGenerating) return;
    setIsGenerating(true);
    try {
      await design.refineAnalysis(feedback.trim());
    } catch {
      useToastStore.getState().addToast('Failed to refine design', 'error');
      setIsGenerating(false);
    }
  }, [design, isGenerating]);

  return {
    isGenerating,
    canGenerate,
    hasIntent,
    hasDesignResult,
    completeness,
    design,
    handleGenerate,
    handleRefine,
  };
}
