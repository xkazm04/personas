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

/**
 * i18n keys for the auto-fix proposal labels surfaced on the "Apply Fix:"
 * button. The string union is enforced at the rule-construction site
 * (PROPOSAL_RULES in useHealthCheck.ts) and resolved at render time by
 * `t.agents.health_proposals[labelKey]`. Adding a new auto-fix means adding
 * a key here AND under `agents.health_proposals` in en.json.
 */
export type HealthProposalLabelKey =
  | 'link_credential'
  | 'auto_match_credentials'
  | 'add_daily_schedule'
  | 'switch_retry_3x'
  | 'add_default_use_case'
  | 'enable_first_run_review';

export interface DryRunProposal {
  labelKey: HealthProposalLabelKey;
  /** Optional interpolation params (e.g. `{ connector: 'slack' }` for `link_credential`). */
  labelParams?: Record<string, string | number>;
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

