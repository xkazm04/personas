import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { EvolutionPolicy } from "@/lib/bindings/EvolutionPolicy";
import type { EvolutionCycle } from "@/lib/bindings/EvolutionCycle";
import type { FitnessObjective } from "@/lib/bindings/FitnessObjective";

// ============================================================================
// Policy management
// ============================================================================

export const getPolicy = (personaId: string) =>
  invoke<EvolutionPolicy | null>("evolution_get_policy", { personaId });

export const upsertPolicy = (
  personaId: string,
  opts: {
    enabled?: boolean;
    fitnessObjective?: FitnessObjective;
    mutationRate?: number;
    variantsPerCycle?: number;
    improvementThreshold?: number;
    minExecutionsBetween?: number;
  },
) =>
  invoke<EvolutionPolicy>("evolution_upsert_policy", {
    personaId,
    ...opts,
  });

export const toggleEvolution = (personaId: string, enabled: boolean) =>
  invoke<EvolutionPolicy>("evolution_toggle", { personaId, enabled });

export const deletePolicy = (personaId: string) =>
  invoke<boolean>("evolution_delete_policy", { personaId });

// ============================================================================
// Cycles
// ============================================================================

export const listCycles = (personaId: string, limit?: number) =>
  invoke<EvolutionCycle[]>("evolution_list_cycles", { personaId, limit });

export const triggerCycle = (personaId: string) =>
  invoke<EvolutionCycle>("evolution_trigger_cycle", { personaId });

export const checkEligibility = (personaId: string) =>
  invoke<boolean>("evolution_check_eligibility", { personaId });
