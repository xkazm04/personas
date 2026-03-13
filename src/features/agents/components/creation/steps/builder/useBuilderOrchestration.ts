import { useState, useEffect, useCallback, useRef, type Dispatch } from 'react';
import type { BuilderState } from './types';
import type { BuilderAction } from './builderReducer';
import { useDesignAnalysis } from '@/hooks/design/core/useDesignAnalysis';
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useToastStore } from '@/stores/toastStore';
import { useDryRun } from './useDryRun';

interface UseBuilderOrchestrationArgs {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  draftPersonaId: string | null;
  setDraftPersonaId: (id: string | null) => void;
}

export function useBuilderOrchestration({
  state,
  dispatch,
  draftPersonaId,
  setDraftPersonaId,
}: UseBuilderOrchestrationArgs) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(['intent', 'useCases']),
  );

  const createPersona = useAgentStore((s) => s.createPersona);
  const createGroup = usePipelineStore((s) => s.createGroup);
  const movePersonaToGroup = usePipelineStore((s) => s.movePersonaToGroup);
  const design = useDesignAnalysis();
  const [isGenerating, setIsGenerating] = useState(false);
  const isCreatingRef = useRef(false);
  const dryRun = useDryRun();
  const [autoTestGen, setAutoTestGen] = useState(0);
  const [logDismissed, setLogDismissed] = useState(false);

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filledUseCases = state.useCases.filter((uc) => uc.title.trim()).length;
  const hasIntent = state.intent.trim().length > 0;
  const hasContent = hasIntent || filledUseCases > 0 || state.components.length > 0;
  const canGenerate = hasIntent && !isGenerating;

  // Watch for design result and apply to builder
  useEffect(() => {
    if (design.phase === 'preview' && design.result && isGenerating) {
      dispatch({ type: 'APPLY_DESIGN_RESULT', payload: design.result });
      // Auto-match credentials from vault
      const creds = useVaultStore.getState().credentials;
      dispatch({ type: 'AUTO_MATCH_CREDENTIALS', payload: { credentials: creds.map((c) => ({ id: c.id, service_type: c.service_type })) } });
      setIsGenerating(false);
      // Expand all sections so the user sees what was filled
      setExpanded(new Set(['intent', 'useCases', 'triggers', 'channels', 'policies']));
      // Trigger silent dry run + auto-fix
      setAutoTestGen((g) => g + 1);
    }
    if (design.error && isGenerating) {
      setIsGenerating(false);
    }
  }, [design.phase, design.result, design.error, isGenerating, dispatch]);

  // Auto-run dry run after generation to silently fix gaps
  useEffect(() => {
    if (autoTestGen > 0 && dryRun.phase === 'idle') {
      dryRun.runTest(state);
    }
  }, [autoTestGen]);

  // Auto-apply all fixable proposals when dry run completes
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
    if (draftPersonaId) {
      isCreatingRef.current = false;
    }
  }, [draftPersonaId]);

  useEffect(() => {
    if (!isGenerating) {
      isCreatingRef.current = false;
    }
  }, [isGenerating]);

  const handleGenerate = useCallback(async () => {
    if (isCreatingRef.current) return;
    if (!canGenerate) return;
    isCreatingRef.current = true;
    setIsGenerating(true);
    setLogDismissed(false);

    try {
      // Create or reuse draft persona
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

        // Move draft to a "Draft" group so it's visible but separated
        try {
          const groups = usePipelineStore.getState().groups;
          let draftGroup = groups.find((g) => g.name === 'Draft');
          if (!draftGroup) {
            draftGroup = await createGroup({ name: 'Draft', color: '#6B7280', description: 'Agents being designed' }) ?? undefined;
          }
          if (draftGroup) {
            await movePersonaToGroup(personaId, draftGroup.id);
          }
        } catch {
          // intentional: non-critical -- draft still works without a group
        }
      }

      // Build enhanced intent with component names grouped by role
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
      useToastStore.getState().addToast('Failed to generate agent -- check your connection', 'error');
      isCreatingRef.current = false;
      setIsGenerating(false);
    }
  }, [canGenerate, draftPersonaId, state.intent, state.components, createPersona, createGroup, movePersonaToGroup, setDraftPersonaId, design]);

  return {
    expanded,
    toggleSection,
    filledUseCases,
    hasIntent,
    hasContent,
    canGenerate,
    isGenerating,
    logDismissed,
    setLogDismissed,
    design,
    handleGenerate,
  };
}
