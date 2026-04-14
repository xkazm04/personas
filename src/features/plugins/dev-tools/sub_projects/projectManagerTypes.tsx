import { Circle, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
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
  createdAt: string;
}

export interface Goal {
  id: string;
  projectId: string;
  title: string;
  status: 'open' | 'in-progress' | 'done' | 'blocked';
  progress: number;
  signals: GoalSignal[];
}

export interface GoalSignal {
  id: string;
  message: string;
  timestamp: string;
  type: 'info' | 'warning' | 'success';
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
    createdAt: dp.created_at.slice(0, 10),
  };
}

export function toGoal(dg: import("@/lib/bindings/DevGoal").DevGoal, signals: import("@/lib/bindings/DevGoalSignal").DevGoalSignal[]): Goal {
  return {
    id: dg.id,
    projectId: dg.project_id,
    title: dg.title,
    status: (dg.status as Goal["status"]) || "open",
    progress: dg.progress,
    signals: signals
      .filter((s) => s.goal_id === dg.id)
      .map((s) => ({
        id: s.id,
        message: s.message ?? s.signal_type,
        timestamp: s.created_at,
        type: (s.signal_type === "success" ? "success" : s.signal_type === "warning" ? "warning" : "info") as GoalSignal["type"],
      })),
  };
}

// ---------------------------------------------------------------------------
// Project type constants
// ---------------------------------------------------------------------------

export type ProjectType = 'react' | 'nodejs' | 'fastapi' | 'rust' | 'python' | 'combined' | 'other';

export const PROJECT_TYPES: { id: ProjectType; label: string; icon: string; color: string }[] = [
  { id: 'react', label: 'React', icon: '⚛️', color: 'bg-cyan-500/15 border-cyan-500/25 text-cyan-400' },
  { id: 'nodejs', label: 'NodeJS', icon: '🟢', color: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' },
  { id: 'fastapi', label: 'FastAPI', icon: '⚡', color: 'bg-teal-500/15 border-teal-500/25 text-teal-400' },
  { id: 'rust', label: 'Rust', icon: '🦀', color: 'bg-orange-500/15 border-orange-500/25 text-orange-400' },
  { id: 'python', label: 'Python', icon: '🐍', color: 'bg-yellow-500/15 border-yellow-500/25 text-yellow-400' },
  { id: 'combined', label: 'Combined', icon: '🔗', color: 'bg-violet-500/15 border-violet-500/25 text-violet-400' },
  { id: 'other', label: 'Other', icon: '📁', color: 'bg-primary/10 border-primary/20 text-muted-foreground' },
];

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

export const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  archived: 'bg-primary/10 text-muted-foreground border-primary/15',
  paused: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  open: 'bg-primary/10 text-muted-foreground border-primary/15',
  'in-progress': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  blocked: 'bg-red-500/15 text-red-400 border-red-500/25',
};

export const GOAL_ICONS: Record<string, typeof Circle> = {
  open: Circle,
  'in-progress': Clock,
  done: CheckCircle2,
  blocked: AlertCircle,
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
}
