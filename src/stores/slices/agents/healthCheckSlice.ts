import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { computeAggregateHealthScore } from "@/features/agents/sub_health/healthScoring";
import { assessAgentHealth } from "@/features/agents/sub_health/agentHealth";
import type { PersonaHealthCheck, AgentHealthDigest } from "@/features/agents/sub_health/types";

// -- Slice interface --------------------------------------------------

export interface HealthCheckSlice {
  // State
  healthDigest: AgentHealthDigest | null;
  healthDigestRunning: boolean;
  lastDigestAt: string | null;

  // Actions
  runFullHealthDigest: () => Promise<AgentHealthDigest | null>;
  clearHealthDigest: () => void;
}

function aggregateDigest(checks: PersonaHealthCheck[]): AgentHealthDigest {
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;
  let totalUndetermined = 0;

  for (const check of checks) {
    for (const issue of check.result.issues) {
      // Explicit per-severity branches, not an `else` tail: the tail is how a
      // fourth verdict gets laundered into the third one. `undetermined` says
      // a sub-check could not run, so it belongs to no persona-facing count.
      if (issue.severity === 'error') totalErrors++;
      else if (issue.severity === 'warning') totalWarnings++;
      else if (issue.severity === 'info') totalInfos++;
      else if (issue.severity === 'undetermined') totalUndetermined++;
    }
  }

  // Mean of the per-agent scores, not the penalty sum over a flattened list:
  // the 100-point budget is per agent, so flattening made the fleet score a
  // function of fleet size and pinned any real install at 0 / unhealthy.
  const totalScore = computeAggregateHealthScore(checks);

  return {
    generatedAt: new Date().toISOString(),
    personas: checks,
    totalScore,
    // Errors + warnings only: an info note is a note (see AgentHealthDigest).
    totalIssues: totalErrors + totalWarnings,
    errorCount: totalErrors,
    warningCount: totalWarnings,
    infoCount: totalInfos,
    undeterminedCount: totalUndetermined,
  };
}

// -- Slice creator ----------------------------------------------------

export const createHealthCheckSlice: StateCreator<AgentStore, [], [], HealthCheckSlice> = (set, get) => ({
  healthDigest: null,
  healthDigestRunning: false,
  lastDigestAt: null,

  runFullHealthDigest: async () => {
    const { personas } = get();
    if (personas.length === 0) return null;

    set({ healthDigestRunning: true });

    try {
      // THE health definition (sub_health/agentHealth.ts), shared with the
      // editor badge: one refresh of the overview telemetry pipeline, the
      // healing issues it stashed, and each persona's config warnings.
      const checks = await assessAgentHealth(personas);
      const digest = aggregateDigest(checks);
      set({ healthDigest: digest, healthDigestRunning: false, lastDigestAt: digest.generatedAt });
      return digest;
    } catch (err) {
      reportError(err, "Failed to run health digest", set, { stateUpdates: { healthDigestRunning: false } });
      return null;
    }
  },

  clearHealthDigest: () => set({ healthDigest: null }),
});
