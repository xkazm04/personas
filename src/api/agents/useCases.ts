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

// ===========================================================================
// Phase C5b — per-capability generation policy + event-rename consumer warning
// ===========================================================================

/**
 * Per-capability generation policy. Mirrors `UseCaseGenerationSettings` in
 * `src-tauri/src/commands/core/use_cases.rs`.
 *
 * - `memories`: 'on' stores agent-emitted memories under this capability;
 *   'off' silently drops them at dispatch.
 * - `reviews`: 'on' queues manual reviews; 'off' drops them; 'trust_llm'
 *   stores them but auto-resolves so they never block a human queue.
 * - `events`: 'on' publishes events; 'off' drops them.
 * - `event_aliases`: rename map applied at emit time. Key = name LLM emits;
 *   value = name actually published.
 */
export interface UseCaseGenerationSettings {
  memories?: 'on' | 'off';
  reviews?: 'on' | 'off' | 'trust_llm';
  events?: 'on' | 'off';
  event_aliases?: Record<string, string>;
}

/**
 * Persist the generation policy onto a single capability. Replaces any prior
 * value. Server invalidates the session pool so the next run reassembles the
 * prompt with the new "Generation policy" section.
 */
export const setUseCaseGenerationSettings = (
  personaId: string,
  useCaseId: string,
  settings: UseCaseGenerationSettings,
) =>
  invoke<UseCaseGenerationSettings>("set_use_case_generation_settings", {
    personaId,
    useCaseId,
    settings,
  });

export interface EventListenerCounts {
  subscriptions: number;
  triggers: number;
}

/**
 * Count how many subscribers/triggers currently listen for `eventType`. Used
 * to warn the user before they rename an event and break consumer wiring.
 * Pass `excludePersonaId` to skip the persona doing the rename.
 */
export const countEventListeners = (
  eventType: string,
  excludePersonaId?: string,
) =>
  invoke<EventListenerCounts>("count_event_listeners", {
    eventType,
    excludePersonaId,
  });

export type RenameConsumerAction = 'update' | 'delete' | 'leave';

export interface RenameEventListenersResult {
  subscriptions_touched: number;
  triggers_touched: number;
  action: RenameConsumerAction;
}

/**
 * Apply the user's chosen action when renaming an event. `update` rewrites
 * consumers to the new name; `delete` drops them; `leave` does nothing
 * (consumers stop receiving the event silently).
 */
export const renameEventListeners = (
  fromEvent: string,
  toEvent: string,
  action: RenameConsumerAction,
  excludePersonaId?: string,
) =>
  invoke<RenameEventListenersResult>("rename_event_listeners", {
    fromEvent,
    toEvent,
    action,
    excludePersonaId,
  });
