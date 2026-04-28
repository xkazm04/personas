import { useAgentStore } from '@/stores/agentStore';

export interface PersonaToken {
  /** Persona id captured at token-creation time. `null` means no persona was active. */
  readonly personaId: string | null;
  /**
   * Returns true iff the captured persona is still the currently-selected
   * persona at the moment of the call. Returns false if the captured id was
   * `null` or if the user has since navigated to a different persona.
   */
  isStillCurrent(): boolean;
}

/**
 * Capture the currently-selected persona's id so a later async resolution can
 * verify it's still the active persona before applying side effects.
 *
 * Use to guard against persona-switch races where an async op started against
 * persona A resolves while the user is now looking at persona B — applying the
 * resolution to B's state would silently corrupt B and (often) leak A's data
 * into B's UI. Three real instances of this bug existed in the editor surface
 * before this util was extracted; the per-call-site comments document each.
 *
 * Example:
 *
 *   const token = capturePersonaToken(selectedPersona?.id ?? null);
 *   const runId = await startArena(token.personaId, models);
 *   if (!token.isStillCurrent()) {
 *     void cancelArena(runId);
 *     return;
 *   }
 *   setActiveRunId(runId);
 */
export function capturePersonaToken(personaId: string | null): PersonaToken {
  return {
    personaId,
    isStillCurrent: () =>
      personaId !== null &&
      useAgentStore.getState().selectedPersona?.id === personaId,
  };
}
