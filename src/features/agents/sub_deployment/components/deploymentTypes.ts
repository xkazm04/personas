import type { CloudDeployment } from '@/api/system/cloud';
import type { GitLabAgent } from '@/api/system/gitlab';
import { DEPLOYMENT_ACCENTS } from './deploymentTokens';

// ---------------------------------------------------------------------------
// Unified row type
// ---------------------------------------------------------------------------

export type DeployTarget = 'cloud' | 'gitlab';

/**
 * Lifecycle status for a row in the unified deployment table.
 *
 * The dashboard merges heterogeneous sources (Personas Cloud, GitLab) into
 * one column, so each variant has a contract that callers MUST honour to
 * keep the dashboard consistent. Use {@link mapCloudStatus} or
 * {@link mapGitlabStatus} — never invent these values inline.
 *
 * - `active` — the deployment is currently serving traffic / accepting
 *   triggers. UI surfaces it as healthy green and exposes "Pause", "Test",
 *   and "Open" actions. Cloud uses literal `"active"`; GitLab uses this
 *   for any agent the API returned (GitLab has no paused/failed signal).
 *
 * - `paused` — the user (or a policy) has explicitly halted the deployment.
 *   It is recoverable via "Resume". Distinct from `failed` because no
 *   error condition exists. Currently only Cloud reports this.
 *
 * - `failed` — the backend reported a TERMINAL error: deployment crashed,
 *   build failed, last invocation errored beyond retry. Requires user
 *   action to recover (redeploy, rotate credentials, etc.). Cloud uses
 *   literal `"failed"`; GitLab does not produce this today.
 *
 * - `unknown` — the source status string did not match any known variant.
 *   This is a safety fallback for forward-compat (the cloud backend may
 *   add new statuses like `"deploying"` or `"degraded"`) and surfaces in
 *   the UI as a neutral grey badge with no actions. **Authors MUST NOT
 *   collapse "deployment is broken" or "heartbeat missing" into `unknown`
 *   — those are `failed`. Reserve `unknown` strictly for unrecognized
 *   strings.**
 */
export type DeployStatus = 'active' | 'paused' | 'failed' | 'unknown';

/**
 * Map a Personas Cloud `CloudDeployment.status` string to a `DeployStatus`.
 *
 * The cloud API uses lowercase tokens. Only `"active"`, `"paused"`, and
 * `"failed"` are recognized today; anything else (including null/undefined)
 * collapses to `unknown` per the contract above.
 */
export function mapCloudStatus(raw: string | null | undefined): DeployStatus {
  if (raw === 'active' || raw === 'paused' || raw === 'failed') return raw;
  return 'unknown';
}

/**
 * Map a GitLab agent record to a `DeployStatus`.
 *
 * GitLab's `/agents` endpoint returns rows only for live agents and provides
 * no lifecycle field — every row is therefore treated as `active`. If a
 * future API surface adds an explicit `status` field, extend this mapper
 * (do NOT branch on it at call sites).
 */
export function mapGitlabStatus(_agent: unknown): DeployStatus {
  return 'active';
}

export interface UnifiedDeployment {
  id: string;
  target: DeployTarget;
  personaName: string;
  personaId: string | null;
  name: string;
  status: DeployStatus;
  invocations: number;
  lastActivity: string | null;
  createdAt: string | null;
  webUrl: string | null;
  /** Original source data for actions */
  _cloud?: CloudDeployment;
  _gitlab?: GitLabAgent;
  _gitlabProjectId?: number;
}

// ---------------------------------------------------------------------------
// Sort types
// ---------------------------------------------------------------------------

export type SortKey = 'name' | 'target' | 'status' | 'invocations' | 'lastActivity' | 'createdAt';
export type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function statusBadge(s: DeployStatus): string {
  const colors: Record<DeployStatus, string> = {
    active: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    paused: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
    failed: 'bg-red-500/10 border-red-500/20 text-red-400',
    unknown: 'bg-secondary/40 border-primary/15 text-foreground',
  };
  return colors[s];
}

export function targetBadge(t: DeployTarget) {
  if (t === 'cloud') return { label: 'Cloud', cls: DEPLOYMENT_ACCENTS.cloud.badge, target: 'cloud' as const };
  return { label: 'GitLab', cls: DEPLOYMENT_ACCENTS.gitlab.badge, target: 'gitlab' as const };
}

// `timeAgo` hoisted to `@/lib/utils/formatters` (Wave 5 consolidation).
export { timeAgo } from '@/lib/utils/formatters';

export function compareValues(a: UnifiedDeployment, b: UnifiedDeployment, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case 'name': cmp = a.name.localeCompare(b.name); break;
    case 'target': cmp = a.target.localeCompare(b.target); break;
    case 'status': cmp = a.status.localeCompare(b.status); break;
    case 'invocations': cmp = a.invocations - b.invocations; break;
    case 'lastActivity': cmp = (a.lastActivity ?? '').localeCompare(b.lastActivity ?? ''); break;
    case 'createdAt': cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? ''); break;
  }
  return dir === 'desc' ? -cmp : cmp;
}
