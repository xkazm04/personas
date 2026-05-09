/**
 * Types for the Agent Health Check system.
 *
 * DryRunResult / DryRunIssue / DryRunProposal were historically re-exported from
 * the retired builder subtree (`src/features/agents/components/creation/`).
 * As of Phase 2 gap closure (INTG-01..03) those types are defined here directly —
 * the builder subtree is being retired in plan 02-07.
 */

// -- Dry Run / Health Check primitives --------------------------------

/**
 * A single action that a health-check fix proposal can apply.
 *
 * Loosely typed on purpose: the only runtime consumer is
 * `src/features/agents/health/useApplyHealthFix.ts` which switches on
 * `action.type` and casts `action.payload` inside each case. Keeping this as
 * a structural `{ type, payload }` tuple avoids re-creating the retired
 * `BuilderAction` discriminated union just for type checking.
 */
export interface HealthFixProposalAction {
  type: string;
  payload?: unknown;
}

export interface DryRunIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  description: string;
  proposal: DryRunProposal | null;
  resolved: boolean;
}

export interface DryRunProposal {
  label: string;
  actions: HealthFixProposalAction[];
}

export interface DryRunResult {
  status: 'ready' | 'partial' | 'blocked';
  capabilities: string[];
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
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

