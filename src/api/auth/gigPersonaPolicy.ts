import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { GigPersonaPolicy } from "@/lib/bindings/GigPersonaPolicy";

export type { GigPersonaPolicy };

/**
 * The gig persona policy (`kp.gig_persona_policy`): the operator's standing
 * approval for kp's one-persona-per-gig hires. Disabled when none is stored.
 * `maxBudgetUsd: null` is NO CAP: a hire request's budget is then neither
 * required nor compared; a number caps each hire at that many USD.
 */
export const getGigPersonaPolicy = () =>
  invoke<GigPersonaPolicy>("kp_gig_persona_policy_get");

/**
 * Store the policy. The backend trims and de-duplicates the model list and
 * stores the root folder in canonical form; the returned value is what was
 * stored. Refused (with a message) when the root is not an existing absolute
 * folder or an enabled policy names none.
 */
export const setGigPersonaPolicy = (policy: GigPersonaPolicy) =>
  invoke<GigPersonaPolicy>("kp_gig_persona_policy_set", { policy });
