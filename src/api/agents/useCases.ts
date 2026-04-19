import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";

/**
 * Counts returned by capability-toggle operations (and the cascade preview).
 *
 * Mirrors `UseCaseToggleResult` in `src-tauri/src/commands/core/use_cases.rs`.
 * Phase C3 — see `docs/concepts/persona-capabilities/02-use-case-as-capability.md`.
 */
export interface UseCaseToggleResult {
  enabled: boolean;
  triggers_updated: number;
  subscriptions_updated: number;
  automations_updated: number;
}

/**
 * Preview the blast radius of toggling a capability: how many triggers,
 * event subscriptions, and automations will be touched by the cascade.
 *
 * The UI uses this to render a confirmation dialog before flipping state.
 */
export const getUseCaseCascade = (personaId: string, useCaseId: string) =>
  invoke<UseCaseToggleResult>("get_use_case_cascade", { personaId, useCaseId });

/**
 * Toggle a capability on/off. Runs transactionally:
 *   - Patches `personas.design_context.useCases[i].enabled`
 *   - Cascades `enabled`/`status` on matching `persona_triggers`
 *   - Cascades `enabled` on matching `persona_event_subscriptions`
 *   - On disable: pauses running automations linked to the capability
 *   - Invalidates the session pool so the next execution reassembles
 *     the prompt with the new capability set
 *
 * Returns the counts of cascaded rows for a post-hoc toast.
 */
export const setUseCaseEnabled = (
  personaId: string,
  useCaseId: string,
  enabled: boolean,
) =>
  invoke<UseCaseToggleResult>("set_use_case_enabled", {
    personaId,
    useCaseId,
    enabled,
  });

/**
 * Simulate a capability: run end-to-end with `sample_input` (or a user
 * override) but flag the execution as a simulation. Notification channels
 * and OS-level pushes are suppressed; the execution row is tagged
 * `is_simulation=true` and filtered out of the default activity feed.
 *
 * Simulations **bypass** the capability's `enabled` gate so users can test
 * a disabled capability before activating it.
 */
export const simulateUseCase = (
  personaId: string,
  useCaseId: string,
  inputOverride?: string,
) =>
  invoke<PersonaExecution>("simulate_use_case", {
    personaId,
    useCaseId,
    inputOverride,
  });
