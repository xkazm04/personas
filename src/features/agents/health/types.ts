/**
 * Types for the Agent Health Check system.
 * Re-uses the existing DryRunResult/DryRunIssue/DryRunProposal types from the builder
 * and adds health-check-specific types for per-persona and digest views.
 */

import type { DryRunResult } from '../components/creation/steps/types';

// Re-export builder types used by health check consumers
export type { DryRunResult, DryRunIssue, DryRunProposal } from '../components/creation/steps/types';

// ── Per-persona health check ─────────────────────────────────────────

export interface PersonaHealthCheck {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  result: DryRunResult;
  checkedAt: string; // ISO timestamp
}

// ── Scoring ──────────────────────────────────────────────────────────

export type HealthGrade = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthScore {
  /** 0-100 numeric score */
  value: number;
  grade: HealthGrade;
}

// ── Agent Health Digest (aggregated across all personas) ─────────────

export interface AgentHealthDigest {
  generatedAt: string;
  personas: PersonaHealthCheck[];
  totalScore: HealthScore;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

// ── Health Check actions for applying fixes to existing personas ──────

export interface HealthFixAction {
  /** Type of fix to apply */
  kind:
    | 'link_credential'
    | 'add_trigger'
    | 'set_error_strategy'
    | 'set_review_policy'
    | 'add_use_case';
  /** Human-readable label */
  label: string;
  /** Payload depends on kind */
  payload: Record<string, unknown>;
}

export interface HealthCheckProposal {
  label: string;
  actions: HealthFixAction[];
}
