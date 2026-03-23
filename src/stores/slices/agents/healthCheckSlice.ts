import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { testDesignFeasibility } from "@/api/templates/design";
import { parseJsonOrDefault } from "@/lib/utils/parseJson";
import { computeHealthScore } from "@/features/agents/health/useHealthCheck";
import type { PersonaHealthCheck, AgentHealthDigest } from "@/features/agents/health/types";
import type { DryRunIssue, DryRunResult } from "@/features/agents/health/types";
import type { Persona } from "@/lib/bindings/Persona";
import type { DesignContextData } from "@/lib/types/frontendTypes";
import { inferIssueSeverity } from "@/lib/errorTaxonomy";

// -- Staleness threshold ----------------------------------------------

/** Data older than 15 minutes is considered stale */
export const DIGEST_STALENESS_MS = 15 * 60 * 1000;

/** Check whether a ISO timestamp is older than the staleness threshold */
export function isTimestampStale(iso: string | null, thresholdMs = DIGEST_STALENESS_MS): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > thresholdMs;
}

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

// -- Helpers ----------------------------------------------------------

let issueSeq = 1;

/** @see {@link inferIssueSeverity} — unified implementation in errorTaxonomy */
const inferSeverity = inferIssueSeverity;

function mapOverallStatus(overall: string): DryRunResult['status'] {
  const o = overall.toLowerCase();
  if (o.includes('ready') || o.includes('pass') || o.includes('success')) return 'ready';
  if (o.includes('block') || o.includes('fail')) return 'blocked';
  return 'partial';
}

async function checkSinglePersona(persona: Persona): Promise<PersonaHealthCheck | null> {
  const ctx = persona.design_context
    ? parseJsonOrDefault<DesignContextData | null>(persona.design_context, null)
    : null;

  const designContext: DesignContextData = ctx ?? { summary: persona.description || persona.name };

  try {
    const raw = await testDesignFeasibility(JSON.stringify(designContext));

    const issues: DryRunIssue[] = raw.issues.map((text) => ({
      id: `digest_${Date.now()}_${issueSeq++}`,
      severity: inferSeverity(text, raw.overall),
      description: text,
      proposal: null, // Digest view shows summary only; fixes are applied from individual health check
      resolved: false,
    }));

    const result: DryRunResult = {
      status: mapOverallStatus(raw.overall),
      capabilities: raw.confirmed_capabilities,
      issues,
    };

    return {
      personaId: persona.id,
      personaName: persona.name,
      personaIcon: persona.icon,
      personaColor: persona.color,
      result,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    // intentional: individual persona health check failure is non-critical; caller aggregates via Promise.allSettled
    return null;
  }
}

function aggregateDigest(checks: PersonaHealthCheck[]): AgentHealthDigest {
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;

  for (const check of checks) {
    for (const issue of check.result.issues) {
      if (issue.severity === 'error') totalErrors++;
      else if (issue.severity === 'warning') totalWarnings++;
      else totalInfos++;
    }
  }

  // Compute aggregate score from all issues across all personas
  const allIssues = checks.flatMap((c) => c.result.issues);
  const totalScore = computeHealthScore(allIssues);

  return {
    generatedAt: new Date().toISOString(),
    personas: checks,
    totalScore,
    totalIssues: totalErrors + totalWarnings + totalInfos,
    errorCount: totalErrors,
    warningCount: totalWarnings,
    infoCount: totalInfos,
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
      // Run health checks on all personas in parallel (max 5 concurrent)
      const checks: PersonaHealthCheck[] = [];
      const batchSize = 5;

      for (let i = 0; i < personas.length; i += batchSize) {
        const batch = personas.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map(checkSinglePersona));
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            checks.push(r.value);
          }
        }
      }

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
