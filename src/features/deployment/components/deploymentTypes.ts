import type { CloudDeployment } from '@/api/system/cloud';
import type { GitLabAgent } from '@/api/system/gitlab';

// ---------------------------------------------------------------------------
// Unified row type
// ---------------------------------------------------------------------------

export type DeployTarget = 'cloud' | 'gitlab';
export type DeployStatus = 'active' | 'paused' | 'failed' | 'unknown';

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
    unknown: 'bg-secondary/40 border-primary/15 text-muted-foreground/80',
  };
  return colors[s];
}

export function targetBadge(t: DeployTarget) {
  if (t === 'cloud') return { label: 'Cloud', cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400', target: 'cloud' as const };
  return { label: 'GitLab', cls: 'bg-orange-500/10 border-orange-500/20 text-orange-400', target: 'gitlab' as const };
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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
