/**
 * Pure health scoring + issue identity.
 *
 * Split out of `useHealthCheck.ts` because the store slice needs these and the
 * hook module imports `useAgentStore` — importing the hook from the slice closed
 * a cycle (slice -> hook -> agentStore -> slice) that resolved
 * `createHealthCheckSlice` to `undefined` at store construction. Nothing here
 * touches a store, a hook, or React, so it is safe for either side to import.
 *
 * `useHealthCheck.ts` re-exports every name below, so existing importers are
 * unaffected.
 */
import type { DryRunIssue, HealthScore, HealthGrade } from './types';
import { GRADE_THRESHOLDS } from '@/features/overview/sub_health/libs/compositeHealthScore';

/**
 * Health scoring configuration. Single source of truth for penalty weights
 * and grade cutoffs — tests and UI both import from here.
 *
 * Rationale:
 * - `errorPenalty` 25 → four unresolved errors = score 0 (failing).
 * - `warningPenalty` 10 → warnings tip a healthy persona into "degraded"
 *   after 3 before dragging it toward "unhealthy".
 * - `infoPenalty` 2 → informational notes nudge the score without dominating.
 * - `degradedCutoff` 80 / `unhealthyCutoff` 50 align with the three grade
 *   bands the editor HealthBadge (EditorTabBar) and the Arena herald paint
 *   (healthy / degraded / unhealthy). HealthScoreDisplay was deleted in
 *   fbf3e6a6a.
 */
export const HEALTH_SCORING = {
  errorPenalty: 25,
  warningPenalty: 10,
  infoPenalty: 2,
  maxScore: 100,
  minScore: 0,
  /**
   * Scores >= this are "healthy". Sourced from the single `GRADE_THRESHOLDS`
   * in the health scoring module so the digest's grade bands can't drift from
   * the Heartbeats / Status-page bands. (The digest keeps its own penalty-based
   * *scoring* — it grades issue severity, not the telemetry composite — but the
   * cutoffs are shared.)
   */
  degradedCutoff: GRADE_THRESHOLDS.healthy,
  /** Scores < this are "unhealthy"; between unhealthyCutoff and degradedCutoff is "degraded". */
  unhealthyCutoff: GRADE_THRESHOLDS.degraded,
} as const;

/** Grade a 0-100 score by the shared cutoffs. One definition for both scorers. */
function gradeForScore(value: number): HealthGrade {
  if (value < HEALTH_SCORING.unhealthyCutoff) return 'unhealthy';
  if (value < HEALTH_SCORING.degradedCutoff) return 'degraded';
  return 'healthy';
}

export function computeHealthScore(issues: DryRunIssue[]): HealthScore {
  const unresolved = issues.filter((i) => !i.resolved);
  const errors = unresolved.filter((i) => i.severity === 'error').length;
  const warnings = unresolved.filter((i) => i.severity === 'warning').length;
  const infos = unresolved.filter((i) => i.severity === 'info').length;

  const penalty =
    errors * HEALTH_SCORING.errorPenalty +
    warnings * HEALTH_SCORING.warningPenalty +
    infos * HEALTH_SCORING.infoPenalty;
  const value = Math.max(HEALTH_SCORING.minScore, Math.min(HEALTH_SCORING.maxScore, HEALTH_SCORING.maxScore - penalty));

  return { value, grade: gradeForScore(value) };
}

/**
 * Fleet-level score: the MEAN of each agent's own score, never the penalty
 * sum over a flattened issue list.
 *
 * `computeHealthScore` spends a fixed 100-point budget, so pouring every
 * agent's issues into one call makes the result a function of fleet size:
 * four errors anywhere in the fleet, or 25 agents each carrying the single
 * `signal_unknown` info note, exhausted the budget and reported grade
 * `unhealthy` for a fleet with nothing wrong. The weekly digest notification
 * reads this number, so large installs were told "0 ❌" every week by
 * construction. Averaging keeps the per-agent semantics of the penalty
 * weights and makes the fleet score comparable week over week as agents are
 * added.
 */
export function computeAggregateHealthScore(
  checks: ReadonlyArray<{ result: { issues: DryRunIssue[] } }>,
): HealthScore {
  if (checks.length === 0) return { value: HEALTH_SCORING.maxScore, grade: 'healthy' };
  const total = checks.reduce((sum, c) => sum + computeHealthScore(c.result.issues).value, 0);
  const value = Math.round(total / checks.length);
  return { value, grade: gradeForScore(value) };
}

/**
 * Generate a deterministic issue ID from `(personaId, severity, description)`.
 *
 * Why deterministic: re-running a health check used to mint fresh random IDs,
 * so any client holding a prior `issueId` (a debounced `markIssueResolved`,
 * an in-flight fix proposal) silently no-op'd against the new result set.
 * Hashing the issue's content keeps identity stable across runs — unchanged
 * issues keep the same ID, and `markIssueResolved` continues to match after
 * a re-check. Determinism also enables future diffing of issue sets across
 * runs.
 *
 * Implementation: 64-bit FNV-1a, hex-encoded. Non-cryptographic, but the
 * collision space is wide enough for the per-persona issue counts we ever
 * surface in the UI.
 *
 * Exported for unit tests.
 */
export function makeIssueId(personaId: string, severity: string, description: string): string {
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK64 = (1n << 64n) - 1n;
  const input = `${personaId}\u0000${severity}\u0000${description}`;
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & MASK64;
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return `hc_${hash.toString(16).padStart(16, '0')}`;
}
