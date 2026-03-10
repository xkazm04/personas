/**
 * confirmSave and cleanupAll actions for useAsyncTransform.
 */
import { useCallback, type MutableRefObject } from 'react';
import {
  clearTemplateAdoptSnapshot,
  confirmTemplateAdoptDraft,
} from '@/api/templates/templateAdopt';
import { usePersonaStore } from '@/stores/personaStore';
import {
  normalizeDraftFromUnknown,
  stringifyDraft,
} from '@/features/templates/sub_n8n/hooks/n8nTypes';
import { applySandboxOverrides } from '@/lib/templates/templateVerification';
import type { SandboxPolicy } from '@/lib/types/templateTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import type { AdoptState } from './useAdoptReducer';
import type { WizardActions } from './asyncTransformTypes';
import {
  clearPersistedContext,
  inflight,
  INFLIGHT_TIMEOUT_MS,
  waitForPersonaInStore,
} from './asyncTransformTypes';

interface UseConfirmSaveOptions {
  state: AdoptState;
  wizard: WizardActions;
  currentAdoptId: string | null;
  confirmingRef: MutableRefObject<boolean>;
  reviewTestCaseName: string | undefined;
  onPersonaCreated: () => void;
  sandboxPolicy: SandboxPolicy | null;
  safetyScan: ScanResult | null;
  resetAdoptStream: () => Promise<void> | void;
}

export function useConfirmSave({
  state,
  wizard,
  currentAdoptId,
  confirmingRef,
  reviewTestCaseName,
  onPersonaCreated,
  sandboxPolicy,
  safetyScan,
  resetAdoptStream,
}: UseConfirmSaveOptions) {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setTemplateAdoptActive = usePersonaStore((s) => s.setTemplateAdoptActive);

  const confirmSave = useCallback(async () => {
    if (confirmingRef.current) return;

    // Block adoption when safety scanner found critical findings and user hasn't acknowledged
    if (safetyScan && safetyScan.critical.length > 0 && !state.safetyCriticalOverride) {
      wizard.setError(
        `Safety scan found ${safetyScan.critical.length} critical finding(s): ${safetyScan.critical.map((f) => f.title).join(', ')}. Acknowledge the findings to proceed.`,
      );
      return;
    }

    const payloadJson = state.draft ? stringifyDraft(state.draft) : state.draftJson.trim();
    if (!payloadJson || state.transforming || state.confirming || state.draftJsonError) return;

    // Module-level idempotency guard: survives remounts unlike the ref.
    // Uses backgroundAdoptId (unique per adoption) as the idempotency key.
    const idempotencyKey = state.backgroundAdoptId ?? `anon-${Date.now()}`;
    if (inflight.has(idempotencyKey)) return;
    const autoCleanup = setTimeout(() => inflight.delete(idempotencyKey), INFLIGHT_TIMEOUT_MS);
    inflight.set(idempotencyKey, autoCleanup);

    confirmingRef.current = true;
    try {
      wizard.confirmStarted();

      let parsed: unknown;
      try { parsed = JSON.parse(payloadJson); } catch (parseErr) {
        const msg = `Draft JSON is malformed: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`;
        const wrapped = new Error(msg);
        (wrapped as Error & { cause: unknown }).cause = parseErr;
        throw wrapped;
      }

      const normalized = normalizeDraftFromUnknown(parsed);
      if (!normalized) {
        throw new Error('Draft JSON is invalid. Please fix draft fields.');
      }

      // Enforce sandbox budget cap on the final draft
      if (sandboxPolicy) {
        const budgetEnforced = applySandboxOverrides(sandboxPolicy, {
          maxConcurrent: 1,
          requireApproval: false,
          maxBudgetUsd: normalized.max_budget_usd,
        });
        normalized.max_budget_usd = budgetEnforced.maxBudgetUsd;
      }

      const response = await confirmTemplateAdoptDraft(stringifyDraft(normalized), reviewTestCaseName);
      wizard.updatePreference('partialEntityErrors', response.entity_errors ?? []);
      await fetchPersonas();
      const personaAvailable = await waitForPersonaInStore(response.persona.id);
      if (personaAvailable) {
        selectPersona(response.persona.id);
      }

      if (response.entity_errors?.length) {
        const failedNames = response.entity_errors.map((e) => `${e.entity_type} "${e.entity_name}"`).join(', ');
        console.warn(`[adopt] Persona created with ${response.entity_errors.length} entity errors: ${failedNames}`);
      }
      wizard.confirmCompleted();

      if (state.backgroundAdoptId) {
        void clearTemplateAdoptSnapshot(state.backgroundAdoptId).catch(() => {});
      }
      clearPersistedContext();
      // Emit tour event so the guided tour can advance
      usePersonaStore.getState().emitTourEvent('tour:template-adopted');
      usePersonaStore.getState().setTourCreatedPersona(response.persona.id);
      onPersonaCreated();
    } catch (err) {
      wizard.confirmFailed(err instanceof Error ? err.message : 'Failed to create persona.');
    } finally {
      confirmingRef.current = false;
      const timer = inflight.get(idempotencyKey);
      if (timer) clearTimeout(timer);
      inflight.delete(idempotencyKey);
    }
  }, [state, wizard, fetchPersonas, selectPersona, onPersonaCreated, reviewTestCaseName, safetyScan, confirmingRef, sandboxPolicy]);

  /** Clean up all async state (for close / reset). */
  const cleanupAll = useCallback(async () => {
    const snapshotId = state.backgroundAdoptId || currentAdoptId;
    if (snapshotId) void clearTemplateAdoptSnapshot(snapshotId).catch(() => {});
    clearPersistedContext();
    void resetAdoptStream();
    setTemplateAdoptActive(false);
  }, [state.backgroundAdoptId, currentAdoptId, resetAdoptStream, setTemplateAdoptActive]);

  return { confirmSave, cleanupAll };
}
