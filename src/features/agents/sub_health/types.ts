/**
 * Types for the Agent Health Check system.
 *
 * DryRunResult / DryRunIssue were historically re-exported from the retired
 * builder subtree (`src/features/agents/components/creation/`) and are defined
 * here directly. The auto-fix proposal shape (`DryRunProposal`,
 * `HealthFixProposalAction`, `HealthProposalLabelKey`) and the per-issue
 * `resolved` flag were deleted on 2026-10-30: their only consumers (the health
 * panel UI and `useApplyHealthFix`) were removed in 2026-08, and a repo-wide
 * grep found no reader of `proposal`, `resolved` or `markIssueResolved`.
 */

// -- Health check primitives ------------------------------------------

export interface DryRunIssue {
  id: string;
  /**
   * `error` / `warning` / `info` are claims about the PERSONA — the check ran
   * and observed something. `undetermined` is a claim about the CHECK: a
   * sub-check could not be run at all (config-warning fetch failed), so
   * nothing is being asserted about the persona. It is never scored
   * (`computeHealthScore` penalises only the first three) and it is counted in
   * its own digest bucket, because folding "never probed" into `info` charges
   * the persona 2 points for the prober's own failure.
   */
  severity: 'error' | 'warning' | 'info' | 'undetermined';
  description: string;
}

export interface DryRunResult {
  status: 'ready' | 'partial' | 'blocked';
  issues: DryRunIssue[];
}

// -- Per-persona health check -----------------------------------------

export interface PersonaHealthCheck {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  result: DryRunResult;
  checkedAt: string; // ISO timestamp
}

// -- Scoring ----------------------------------------------------------

export type HealthGrade = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthScore {
  /** 0-100 numeric score */
  value: number;
  grade: HealthGrade;
}

// -- Agent Health Digest (aggregated across all personas) -------------

export interface AgentHealthDigest {
  generatedAt: string;
  personas: PersonaHealthCheck[];
  totalScore: HealthScore;
  /**
   * Errors + warnings: the things that need attention. Info notes are notes
   * (`infoCount`), not issues: counting them here told an info-only fleet it
   * had "3 issues (0 errors, 0 warnings)".
   */
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Sub-checks that could not run. Not part of `totalIssues` and not scored. */
  undeterminedCount: number;
}
