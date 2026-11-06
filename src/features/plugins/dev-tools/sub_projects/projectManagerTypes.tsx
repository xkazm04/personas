import { StatusBadge as SharedStatusBadge } from '@/features/shared/components/display/StatusBadge';

// ---------------------------------------------------------------------------
// Types – thin view-models mapped from store bindings
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  techStack: string[];
  goalCount: number;
  status: 'active' | 'archived' | 'paused';
  /** The project switch (e32): false overrules every persona in the project. */
  enabled: boolean;
  createdAt: string;
  githubUrl?: string;
  teamId?: string;
  testEnvUrl?: string;
  testEnvBranch?: string;
  mainBranch?: string;
  /** Standards & branching policy JSON (Pipeline Stage 3), or undefined. */
  standardsConfig?: string;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function toProject(dp: import("@/lib/bindings/DevProject").DevProject, goalCount: number): Project {
  return {
    id: dp.id,
    name: dp.name,
    path: dp.root_path,
    description: dp.description ?? undefined,
    techStack: dp.tech_stack ? dp.tech_stack.split(",").map((s) => s.trim()).filter(Boolean) : [],
    goalCount,
    status: (dp.status as Project["status"]) || "active",
    enabled: dp.enabled,
    createdAt: dp.created_at.slice(0, 10),
    githubUrl: dp.github_url ?? undefined,
    teamId: dp.team_id ?? undefined,
    testEnvUrl: dp.test_env_url ?? undefined,
    testEnvBranch: dp.test_env_branch ?? undefined,
    mainBranch: dp.main_branch ?? undefined,
    standardsConfig: dp.standards_config ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Project type constants
// ---------------------------------------------------------------------------

export type ProjectType = 'react' | 'nodejs' | 'fastapi' | 'rust' | 'python' | 'combined' | 'other';

export const PROJECT_TYPES: { id: ProjectType; label: string; icon: string; color: string }[] = [
  { id: 'react', label: 'React', icon: '⚛️', color: 'bg-status-info/15 border-status-info/25 text-status-info' },
  { id: 'nodejs', label: 'NodeJS', icon: '🟢', color: 'bg-status-success/15 border-status-success/25 text-status-success' },
  { id: 'fastapi', label: 'FastAPI', icon: '⚡', color: 'bg-role-external/15 border-role-external/25 text-role-external' },
  { id: 'rust', label: 'Rust', icon: '🦀', color: 'bg-status-warning/15 border-status-warning/25 text-status-warning' },
  { id: 'python', label: 'Python', icon: '🐍', color: 'bg-status-warning/15 border-status-warning/25 text-status-warning' },
  { id: 'combined', label: 'Combined', icon: '🔗', color: 'bg-role-agent/15 border-role-agent/25 text-role-agent' },
  { id: 'other', label: 'Other', icon: '📁', color: 'bg-primary/10 border-primary/20 text-foreground' },
];

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

export const STATUS_STYLES: Record<string, string> = {
  active: 'bg-status-success/15 text-status-success border-status-success/25',
  archived: 'bg-primary/10 text-foreground border-primary/15',
  paused: 'bg-status-warning/15 text-status-warning border-status-warning/25',
  open: 'bg-primary/10 text-foreground border-primary/15',
  'in-progress': 'bg-status-info/15 text-status-info border-status-info/25',
  done: 'bg-status-success/15 text-status-success border-status-success/25',
  blocked: 'bg-status-error/15 text-status-error border-status-error/25',
};

const STATUS_TO_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  active: 'success',
  done: 'success',
  'in-progress': 'info',
  paused: 'warning',
  blocked: 'error',
  archived: 'neutral',
  open: 'neutral',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <SharedStatusBadge variant={STATUS_TO_VARIANT[status] ?? 'neutral'} pill>
      {status.replace('-', ' ')}
    </SharedStatusBadge>
  );
}

export interface EditProjectData {
  id: string;
  name: string;
  path: string;
  projectType: ProjectType;
  githubUrl: string;
  teamId: string | null;
  /** Vault GitHub PAT credential id bound for PR / source-control operations. */
  prCredentialId: string | null;
  /** URL of the living test environment this project/team delivers into. */
  testEnvUrl: string;
  /** Branch deployed to the living test environment (e.g. `staging`). */
  testEnvBranch: string;
  /** Project's primary/default branch (e.g. `main`/`master`). */
  mainBranch: string;
  /** Standards & branching policy JSON (Pipeline Stage 3); '' when unset. */
  standardsConfig: string;
}
