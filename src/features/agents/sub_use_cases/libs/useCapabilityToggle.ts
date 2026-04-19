import { useCallback, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { useAgentStore } from '@/stores/agentStore';
import {
  getUseCaseCascade,
  setUseCaseEnabled,
  simulateUseCase,
  type UseCaseToggleResult,
} from '@/api/agents/useCases';
import { toastCatch } from '@/lib/silentCatch';
import { createLogger } from '@/lib/log';

const logger = createLogger('use-capability-toggle');

/**
 * Confirmation state for disabling a capability.
 *
 * When the user clicks "pause" and the capability has linked triggers or
 * subscriptions, we open a dialog showing the cascade counts before
 * executing the toggle. Enabling (resuming) skips the dialog — the cascade
 * is always safe on activation.
 */
export interface DisableConfirmationState {
  useCaseId: string;
  useCaseTitle: string;
  preview: UseCaseToggleResult;
}

/**
 * Hook that wires up the three capability-management actions:
 *   1. Toggle enabled (with disable-confirmation flow)
 *   2. Simulate (direct — no confirmation)
 *   3. Preview cascade (used by the dialog)
 *
 * Refreshes the persona after a successful toggle so the UI reflects the
 * new capability state + triggers.
 *
 * Phase C3 — see `docs/concepts/persona-capabilities/02-use-case-as-capability.md`.
 */
export function useCapabilityToggle() {
  const [pendingUseCaseId, setPendingUseCaseId] = useState<string | null>(null);
  const [disableConfirmation, setDisableConfirmation] = useState<DisableConfirmationState | null>(null);

  const fetchDetail = useAgentStore((s) => s.fetchDetail);

  /**
   * Entry point for the toggle button. If the user is activating a
   * capability, apply immediately. If disabling and there are cascaded
   * triggers/subs, open the confirmation dialog instead.
   */
  const requestToggle = useCallback(
    async (personaId: string, useCaseId: string, useCaseTitle: string, nextEnabled: boolean) => {
      if (nextEnabled) {
        // Activation path — no confirmation needed.
        await applyToggle(personaId, useCaseId, true);
        return;
      }

      // Deactivation — preview cascade first.
      try {
        const preview = await getUseCaseCascade(personaId, useCaseId);
        const hasCascade =
          preview.triggers_updated > 0
          || preview.subscriptions_updated > 0
          || preview.automations_updated > 0;
        if (hasCascade) {
          setDisableConfirmation({ useCaseId, useCaseTitle, preview });
        } else {
          await applyToggle(personaId, useCaseId, false);
        }
      } catch (err) {
        toastCatch('useCapabilityToggle:preview')(err);
        logger.error('Failed to preview cascade', { error: err instanceof Error ? err.message : String(err) });
      }
    },
    [],
  );

  /** Actually flip the capability and show the result toast. */
  const applyToggle = useCallback(
    async (personaId: string, useCaseId: string, enabled: boolean) => {
      setPendingUseCaseId(useCaseId);
      try {
        const result = await setUseCaseEnabled(personaId, useCaseId, enabled);
        const verb = enabled ? 'Activated' : 'Paused';
        const bits: string[] = [];
        if (result.triggers_updated > 0) bits.push(`${result.triggers_updated} trigger${result.triggers_updated === 1 ? '' : 's'}`);
        if (result.subscriptions_updated > 0) bits.push(`${result.subscriptions_updated} subscription${result.subscriptions_updated === 1 ? '' : 's'}`);
        if (result.automations_updated > 0) bits.push(`${result.automations_updated} automation${result.automations_updated === 1 ? '' : 's'}`);
        const suffix = bits.length > 0 ? ` (cascaded: ${bits.join(', ')})` : '';
        useToastStore.getState().addToast(`${verb} capability${suffix}`, 'success');
        // Refresh so the UI picks up updated design_context + trigger rows.
        await fetchDetail(personaId);
      } catch (err) {
        toastCatch('useCapabilityToggle:apply')(err);
        logger.error('Failed to toggle capability', {
          use_case_id: useCaseId,
          enabled,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPendingUseCaseId(null);
      }
    },
    [fetchDetail],
  );

  const confirmDisable = useCallback(
    async (personaId: string) => {
      if (!disableConfirmation) return;
      const { useCaseId } = disableConfirmation;
      setDisableConfirmation(null);
      await applyToggle(personaId, useCaseId, false);
    },
    [disableConfirmation, applyToggle],
  );

  const cancelDisable = useCallback(() => setDisableConfirmation(null), []);

  /** Simulate — bypasses the enable gate, suppresses notifications. */
  const requestSimulate = useCallback(async (personaId: string, useCaseId: string) => {
    try {
      await simulateUseCase(personaId, useCaseId);
      useToastStore.getState().addToast('Simulation started', 'success');
    } catch (err) {
      toastCatch('useCapabilityToggle:simulate')(err);
      logger.error('Failed to start simulation', {
        use_case_id: useCaseId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return {
    pendingUseCaseId,
    disableConfirmation,
    requestToggle,
    confirmDisable,
    cancelDisable,
    requestSimulate,
  };
}
