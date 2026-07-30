import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { EvolutionPolicy } from "@/lib/bindings/EvolutionPolicy";
import type { EvolutionCycle } from "@/lib/bindings/EvolutionCycle";
import type { EvolutionPromotionProposal } from "@/lib/bindings/EvolutionPromotionProposal";
import type { FitnessObjective } from "@/lib/bindings/FitnessObjective";
import type { CliCapabilities } from "@/lib/bindings/CliCapabilities";

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
    enabled: opts.enabled,
    fitnessObjective: opts.fitnessObjective,
    mutationRate: opts.mutationRate,
    variantsPerCycle: opts.variantsPerCycle,
    improvementThreshold: opts.improvementThreshold,
    minExecutionsBetween: opts.minExecutionsBetween,
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

// ============================================================================
// Promotion proposals (Darwin Mode v1 — human-gated, no auto-promotion)
// ============================================================================

/**
 * List promotion proposals, newest first. A proposal is filed by an evolution
 * cycle whose measured challenger beat the incumbent by the policy threshold;
 * nothing is applied until `resolvePromotionProposal(..., true)`.
 */
export const listPromotionProposals = (opts?: {
  personaId?: string;
  status?: "pending" | "approved" | "rejected";
  limit?: number;
}) =>
  invoke<EvolutionPromotionProposal[]>("evolution_list_promotion_proposals", {
    personaId: opts?.personaId,
    status: opts?.status,
    limit: opts?.limit,
  });

/**
 * Approve (apply winner genome + log to persona change log) or reject a
 * pending promotion proposal. Approval fails closed if the persona changed
 * since the cycle ran.
 */
export const resolvePromotionProposal = (
  proposalId: string,
  approve: boolean,
  note?: string,
) =>
  invoke<EvolutionPromotionProposal>("evolution_resolve_promotion_proposal", {
    proposalId,
    approve,
    note,
  });

// ============================================================================
// CLI capability probe
// ============================================================================

/**
 * Probe the local Claude Code CLI for the capabilities the evolution / deep
 * fanout paths depend on.
 *
 * Not free: spawns a bounded `claude -p` subprocess. Success is cached on the
 * backend, so a ready machine pays it once per launch — but a REJECTED probe
 * is not cached, and callers should defer it out of the cold-start window.
 *
 * A rejection means "binary missing OR no working subscription session"; the
 * command does not distinguish the two.
 */
export const probeCliCapabilities = () =>
  invoke<CliCapabilities>("probe_cli_capabilities", {});
