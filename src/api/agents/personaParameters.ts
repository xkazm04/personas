import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { Persona } from "@/lib/bindings/Persona";

/** Update only the persona's `parameters` JSON column. Bypasses the heavier
 *  `update_persona` path so the engine can pick up new parameter values
 *  immediately (session cache is invalidated server-side). Pass `null` to
 *  clear all parameters. */
export const updatePersonaParameters = (id: string, parameters: string | null) =>
  invoke<Persona>("update_persona_parameters", { id, parameters });

/**
 * Re-derive the persona's `parameters` column from the `{{param}}` placeholders
 * in its adopted recipes / use cases (`engine::recipe_parameters`) and return
 * the updated persona. Idempotent; call after adopting or unadopting a recipe.
 *
 * Callers that only care about the side effect can ignore the return value —
 * the persona store refetches on its own — but the fresh row is returned so a
 * caller can avoid the extra read.
 */
export const syncCapabilityParameters = (personaId: string) =>
  invoke<Persona>("sync_capability_parameters", { personaId });
