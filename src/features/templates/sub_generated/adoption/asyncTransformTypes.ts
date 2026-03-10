/**
 * Types, constants, and helpers shared across the useAsyncTransform split modules.
 */
import { usePersonaStore } from '@/stores/personaStore';
import type { SandboxPolicy } from '@/lib/types/templateTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { AdoptState, PersistedAdoptContext } from './useAdoptReducer';
import { ADOPT_CONTEXT_KEY } from './useAdoptReducer';

// Re-export for convenience
export { ADOPT_CONTEXT_KEY };
export type { PersistedAdoptContext };

// -- Helpers --

/** Remove persisted adoption context from localStorage. Non-critical - silently ignores errors. */
export function clearPersistedContext() {
  try { window.localStorage.removeItem(ADOPT_CONTEXT_KEY); } catch { /* non-critical */ }
}

// Module-level map of adopt IDs that have an in-flight confirmSave.
// Survives component remounts, preventing duplicate persona creation
// when the wizard unmounts and remounts while a confirm is pending.
// Each entry stores a timeout that auto-cleans stale keys after 2 minutes,
// so a hung or failed call doesn't permanently block retries.
export const inflight = new Map<string, ReturnType<typeof setTimeout>>();
export const INFLIGHT_TIMEOUT_MS = 120_000;

export async function waitForPersonaInStore(personaId: string, attempts = 10, delayMs = 50): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const exists = usePersonaStore.getState().personas.some((persona) => persona.id === personaId);
    if (exists) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

// -- Types --

export interface WizardActions {
  transformStarted: (adoptId: string) => void;
  transformLines: (lines: string[]) => void;
  transformPhase: (phase: 'idle' | 'running' | 'completed' | 'failed') => void;
  transformCompleted: (draft: N8nPersonaDraft) => void;
  transformFailed: (error: string) => void;
  transformCancelled: () => void;
  questionsGenerated: (questions: TransformQuestionResponse[]) => void;
  awaitingAnswers: (questions: TransformQuestionResponse[]) => void;
  confirmStarted: () => void;
  confirmCompleted: () => void;
  confirmFailed: (error: string) => void;
  restoreContext: (templateName: string, designResultJson: string, adoptId: string) => void;
  setAdjustment: (text: string) => void;
  updatePreference: (key: string, value: unknown) => void;
  draftUpdated: (draft: N8nPersonaDraft) => void;
  reset: () => void;
  setError: (error: string) => void;
}

export interface UseAsyncTransformOptions {
  state: AdoptState;
  wizard: WizardActions;
  reviewTestCaseName: string | undefined;
  onPersonaCreated: () => void;
  isOpen: boolean;
  sandboxPolicy: SandboxPolicy | null;
  /** Safety scan results - confirmSave is blocked when critical findings exist without override. */
  safetyScan: ScanResult | null;
}
