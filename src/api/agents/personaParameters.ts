import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { Persona } from "@/lib/bindings/Persona";

/** Update only the persona's `parameters` JSON column. Bypasses the heavier
 *  `update_persona` path so the engine can pick up new parameter values
 *  immediately (session cache is invalidated server-side). Pass `null` to
 *  clear all parameters. */
export const updatePersonaParameters = (id: string, parameters: string | null) =>
  invoke<Persona>("update_persona_parameters", { id, parameters });
