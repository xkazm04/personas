/**
 * Shared motion config for negotiator phase transitions. Used by
 * NegotiatorPanel (orchestrating wrapper) and NegotiatorPhases (per-phase
 * components). Defining it once removes the drift trap of two near-identical
 * copies in two files.
 */
export const PHASE_VARIANTS = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const PHASE_TRANSITION = { duration: 0.2 };
