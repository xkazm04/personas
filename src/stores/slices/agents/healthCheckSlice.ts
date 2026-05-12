import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { useOverviewStore } from "@/stores/overviewStore";
import { listHealingIssues } from "@/api/overview/healing";
import {
  computeHealthScore,
  makeIssueId,
} from "@/features/agents/health/useHealthCheck";
import type {
  PersonaHealthCheck,
  AgentHealthDigest,
  DryRunIssue,
  DryRunResult,
} from "@/features/agents/health/types";
import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { PersonaHealthSignal } from "@/stores/slices/overview/personaHealthSlice";
import { silentCatch } from "@/lib/silentCatch";
import { getActiveTranslations, interpolate } from "@/i18n/useTranslation";

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

// -- Real-signal heuristics -------------------------------------------

const HIGH_LATENCY_MS = 30_000;

function pushIssue(
  list: DryRunIssue[],
  personaId: string,
  severity: DryRunIssue['severity'],
  description: string,
): void {
  list.push({
    id: makeIssueId(personaId, severity, description),
    severity,
    description,
    proposal: null,
    resolved: false,
  });
}

/**
 * Derive a DryRunResult from the real per-persona telemetry signals that
 * the overview health pipeline already computes (heartbeat composite,
 * burn rate, healing issues, failure trend). This replaces the static
 * design-feasibility check that produced low-signal items like "Missing
 * structured_prompt section" — the digest is now a live operational
 * health view backed by execution data.
 */
function buildResultFromSignals(
  persona: Persona,
  signal: PersonaHealthSignal | undefined,
  healingIssues: PersonaHealingIssue[],
): DryRunResult {
  const t = getActiveTranslations().agents.health_digest;
  const issues: DryRunIssue[] = [];

  // Healing — itemise each open issue so the modal lists actionable detail.
  const openHealing = healingIssues.filter((h) => h.status !== 'resolved');
  for (const h of openHealing) {
    const sev = h.severity.toLowerCase();
    if (sev === 'error' || sev === 'critical' || h.is_circuit_breaker) {
      pushIssue(issues, persona.id, 'error',
        interpolate(t.signal_open_healing_error, { title: h.title }));
    } else if (sev === 'warning' || sev === 'warn') {
      pushIssue(issues, persona.id, 'warning',
        interpolate(t.signal_open_healing_warning, { title: h.title }));
    }
  }

  if (!signal) {
    // No telemetry yet — flag once as info so the agent still appears.
    if (openHealing.length === 0) {
      pushIssue(issues, persona.id, 'info', t.signal_unknown);
    }
    return finalise(issues);
  }

  // Errors — high-confidence operational breakage.
  if (signal.rollbackCount > 0) {
    pushIssue(issues, persona.id, 'error',
      interpolate(t.signal_circuit_breaker, { count: signal.rollbackCount }));
  }
  if (signal.budgetRatio >= 1) {
    pushIssue(issues, persona.id, 'error',
      interpolate(t.signal_over_budget, { pct: Math.round(signal.budgetRatio * 100) }));
  }
  if (signal.projectedExhaustionDays === 0) {
    pushIssue(issues, persona.id, 'error', t.signal_budget_exhausted);
  }

  // Warnings — degrading state worth attention.
  if (signal.budgetRatio > 0.8 && signal.budgetRatio < 1) {
    pushIssue(issues, persona.id, 'warning',
      interpolate(t.signal_budget_near_cap, { pct: Math.round(signal.budgetRatio * 100) }));
  }
  if (
    signal.projectedExhaustionDays !== null &&
    signal.projectedExhaustionDays > 0 &&
    signal.projectedExhaustionDays <= 7
  ) {
    pushIssue(issues, persona.id, 'warning',
      interpolate(t.signal_budget_exhausts_soon, { days: signal.projectedExhaustionDays }));
  }
  if (signal.healingFrequency > 0.5) {
    const recent7 = Math.round(signal.healingFrequency * 7);
    if (recent7 > 0) {
      pushIssue(issues, persona.id, 'warning',
        interpolate(t.signal_healing_frequency, { count: recent7 }));
    }
  }
  if (signal.failureTrend === 'degrading') {
    pushIssue(issues, persona.id, 'warning', t.signal_failure_trend_degrading);
  }
  if (signal.successRateSource !== 'unknown' && signal.successRate < 80) {
    pushIssue(issues, persona.id, 'warning',
      interpolate(t.signal_low_success_rate, { pct: Math.round(signal.successRate) }));
  }

  // Info — soft hints; not blocking but useful in the modal.
  if (signal.totalExecutions > 0 && signal.recentExecutions === 0) {
    pushIssue(issues, persona.id, 'info', t.signal_inactive);
  }
  if (
    signal.predictedFailureInDays !== null &&
    signal.predictedFailureInDays <= 30
  ) {
    pushIssue(issues, persona.id, 'info',
      interpolate(t.signal_predicted_failure, { days: signal.predictedFailureInDays }));
  }
  if (signal.avgLatencyMs > HIGH_LATENCY_MS) {
    pushIssue(issues, persona.id, 'info',
      interpolate(t.signal_high_latency, { seconds: Math.round(signal.avgLatencyMs / 1000) }));
  }

  if (issues.length === 0 && signal.totalExecutions === 0) {
    pushIssue(issues, persona.id, 'info', t.signal_unknown);
  }

  return finalise(issues);
}

function finalise(issues: DryRunIssue[]): DryRunResult {
  const hasError = issues.some((i) => i.severity === 'error');
  const hasNonInfo = issues.some((i) => i.severity !== 'info');
  const status: DryRunResult['status'] =
    hasError ? 'blocked' :
    issues.length > 0 ? (hasNonInfo ? 'partial' : 'partial') :
    'ready';
  return { status, capabilities: [], issues };
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
      // Pull real telemetry: refresh the overview health pipeline (heartbeat,
      // burn rate, failure trend per persona) and fetch open healing issues
      // for surfacing per-persona titles in the modal.
      const overview = useOverviewStore.getState();
      const [, healingIssuesResult] = await Promise.allSettled([
        overview.refreshHealthDashboard(),
        listHealingIssues(),
      ]);

      const healingIssues: PersonaHealingIssue[] = healingIssuesResult.status === 'fulfilled'
        ? healingIssuesResult.value
        : [];

      const signals = useOverviewStore.getState().healthSignals;
      const signalById = new Map(signals.map((s) => [s.personaId, s] as const));
      const healingByPersona = new Map<string, PersonaHealingIssue[]>();
      for (const h of healingIssues) {
        const list = healingByPersona.get(h.persona_id) ?? [];
        list.push(h);
        healingByPersona.set(h.persona_id, list);
      }

      const checks: PersonaHealthCheck[] = personas.map((persona) => ({
        personaId: persona.id,
        personaName: persona.name,
        personaIcon: persona.icon,
        personaColor: persona.color,
        result: buildResultFromSignals(
          persona,
          signalById.get(persona.id),
          healingByPersona.get(persona.id) ?? [],
        ),
        checkedAt: new Date().toISOString(),
      }));

      const digest = aggregateDigest(checks);
      set({ healthDigest: digest, healthDigestRunning: false, lastDigestAt: digest.generatedAt });
      return digest;
    } catch (err) {
      silentCatch('healthCheckSlice:runFullHealthDigest')(err);
      reportError(err, "Failed to run health digest", set, { stateUpdates: { healthDigestRunning: false } });
      return null;
    }
  },

  clearHealthDigest: () => set({ healthDigest: null }),
});
