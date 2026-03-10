/**
 * useAdoptionInit — handles wizard initialization on open and draft restoration.
 *
 * Extracted from AdoptionWizardContext to isolate init/restore concerns.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { AgentIR } from '@/lib/types/designTypes';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { usePersonaStore } from '@/stores/personaStore';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import type { useAdoptReducer } from './useAdoptReducer';

interface UseAdoptionInitOptions {
  isOpen: boolean;
  review: PersonaDesignReview | null;
  wizard: ReturnType<typeof useAdoptReducer>;
  manualSelectionsRef: MutableRefObject<Set<string>>;
  autoResolveRanRef: MutableRefObject<boolean>;
  highWaterMarkRef: MutableRefObject<number>;
}

/**
 * Runs initialization when the wizard opens and restores saved drafts.
 * Returns `draftRestoredRef` so downstream hooks can defer until restore completes.
 */
export function useAdoptionInit({
  isOpen,
  review,
  wizard,
  manualSelectionsRef,
  autoResolveRanRef,
  highWaterMarkRef,
}: UseAdoptionInitOptions) {
  const { state } = wizard;
  const storedDraft = usePersonaStore((s) => s.adoptionDraft);
  const setAdoptionDraft = usePersonaStore((s) => s.setAdoptionDraft);
  const draftRestoredRef = useRef(false);

  // ── Initialize on open ──
  useEffect(() => {
    if (!isOpen || !review) return;
    if (state.backgroundAdoptId) return;

    const designResult = parseJsonSafe<AgentIR | null>(review.design_result, null);
    if (!designResult) return;

    manualSelectionsRef.current = new Set();
    autoResolveRanRef.current = false;
    draftRestoredRef.current = false;
    highWaterMarkRef.current = 0;
    wizard.init(review.test_case_name, review.id, designResult, review.design_result ?? '');
  }, [isOpen, review, wizard.init, state.backgroundAdoptId, manualSelectionsRef, autoResolveRanRef, highWaterMarkRef]);

  // ── Restore saved draft (runs once after init or context restoration) ──
  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (!isOpen || !storedDraft || !review) return;
    if (storedDraft.reviewId !== review.id) return;

    // Case 1: Normal restore — init completed, step='choose', designResult ready
    const normalRestore = state.step === 'choose' && !!state.designResult;
    // Case 2: Context restore — background transform resumed, backgroundAdoptId set
    const contextRestore = !!state.backgroundAdoptId;

    if (!normalRestore && !contextRestore) return;

    draftRestoredRef.current = true;

    // Restore connector swaps
    for (const [original, replacement] of Object.entries(storedDraft.connectorSwaps)) {
      wizard.swapConnector(original, replacement);
    }
    // Restore credential mappings
    for (const [name, id] of Object.entries(storedDraft.connectorCredentialMap)) {
      wizard.setConnectorCredential(name, id);
    }
    // Restore variable values
    for (const [key, val] of Object.entries(storedDraft.variableValues)) {
      wizard.updateVariable(key, val);
    }

    // Restore extended state (preferences, trigger configs, answers)
    if (storedDraft.triggerConfigs) {
      for (const [idx, config] of Object.entries(storedDraft.triggerConfigs)) {
        wizard.updateTriggerConfig(Number(idx), config);
      }
    }
    if (storedDraft.requireApproval !== undefined) wizard.updatePreference('requireApproval', storedDraft.requireApproval);
    if (storedDraft.autoApproveSeverity) wizard.updatePreference('autoApproveSeverity', storedDraft.autoApproveSeverity);
    if (storedDraft.reviewTimeout) wizard.updatePreference('reviewTimeout', storedDraft.reviewTimeout);
    if (storedDraft.memoryEnabled !== undefined) wizard.updatePreference('memoryEnabled', storedDraft.memoryEnabled);
    if (storedDraft.memoryScope !== undefined) wizard.updatePreference('memoryScope', storedDraft.memoryScope);
    if (storedDraft.userAnswers) {
      wizard.updatePreference('userAnswers', storedDraft.userAnswers);
    }

    // Restore entity selections (Phase C fix — Area #13)
    if (storedDraft.selectedUseCaseIds) {
      wizard.selectAllUseCases(storedDraft.selectedUseCaseIds);
    }

    // Navigate to saved step
    if (normalRestore) {
      wizard.goToStep(storedDraft.step);
    }
    // Clear the draft from store since it's now loaded
    setAdoptionDraft(null);
  }, [isOpen, storedDraft, review, state.step, state.designResult, state.backgroundAdoptId, wizard, setAdoptionDraft]);

  return { storedDraft, draftRestoredRef };
}
