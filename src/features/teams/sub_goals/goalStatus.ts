/**
 * Canonical goal-status model — the single source of truth for the Goals module.
 *
 * v1 had the same status compared as both `'in-progress'` (hyphen, written by the
 * editor + Athena, persisted to `dev_goals.status`) and `'in_progress'` (underscore,
 * matched by the Kanban lanes) — `GoalDetailDrawer` even defined both keys in one
 * record. That silently mis-laned every in-progress goal. v2 funnels everything
 * through `normalizeGoalStatus` and one `GOAL_STATUS_META` table; no component
 * compares a raw status string or carries its own colour map.
 */
import type { ComponentType } from 'react';
import { Circle, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Translations } from '@/i18n/en';

/** The four canonical dev-goal statuses (hyphen form — what the DB persists). */
export type GoalStatus = 'open' | 'in-progress' | 'blocked' | 'done';

export const GOAL_STATUSES: readonly GoalStatus[] = ['open', 'in-progress', 'blocked', 'done'];

/** Kanban lanes (your turn → agent's turn → done). */
export type GoalLane = 'your_turn' | 'agent_turn' | 'done';

/**
 * Tolerant normalizer: maps every legacy / underscore / team-step / alias form
 * onto the canonical set. Unknown input falls back to `open` (never throws).
 */
export function normalizeGoalStatus(raw: string | null | undefined): GoalStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'in-progress':
    case 'in_progress':
    case 'running':
    case 'active':
    case 'matching':
      return 'in-progress';
    case 'blocked':
    case 'review':
    case 'awaiting_review':
      return 'blocked';
    case 'done':
    case 'completed':
    case 'complete':
    case 'skipped':
      return 'done';
    case 'open':
    case 'pending':
    case 'todo':
    case 'queued':
    default:
      return 'open';
  }
}

export const isComplete = (s: string): boolean => normalizeGoalStatus(s) === 'done';
export const isBlocked = (s: string): boolean => normalizeGoalStatus(s) === 'blocked';
export const isInProgress = (s: string): boolean => normalizeGoalStatus(s) === 'in-progress';
export const isOpen = (s: string): boolean => normalizeGoalStatus(s) === 'open';
/** Not terminal — counts as active work (drives at-risk / portfolio rollups). */
export const isOngoing = (s: string): boolean => normalizeGoalStatus(s) !== 'done';

export interface GoalStatusMeta {
  readonly icon: ComponentType<{ className?: string }>;
  readonly lane: GoalLane;
  /** badge/chip classes: text + border + bg, theme-token based. */
  readonly chipClass: string;
  /** accent text colour (dots, icons). */
  readonly tint: string;
  /** map-node colours (force-graph). */
  readonly map: { readonly fill: string; readonly stroke: string; readonly glow: string };
}

export const GOAL_STATUS_META: Record<GoalStatus, GoalStatusMeta> = {
  open: {
    icon: Circle,
    lane: 'your_turn',
    chipClass: 'text-blue-400 border-blue-500/25 bg-blue-500/10',
    tint: 'text-blue-400',
    map: { fill: '#3B82F6', stroke: '#60A5FA', glow: 'rgba(59, 130, 246, 0.35)' },
  },
  'in-progress': {
    icon: Clock,
    lane: 'agent_turn',
    chipClass: 'text-amber-400 border-amber-500/25 bg-amber-500/10',
    tint: 'text-amber-400',
    map: { fill: '#F59E0B', stroke: '#FBBF24', glow: 'rgba(245, 158, 11, 0.4)' },
  },
  blocked: {
    icon: AlertCircle,
    lane: 'your_turn',
    chipClass: 'text-red-400 border-red-500/25 bg-red-500/10',
    tint: 'text-red-400',
    map: { fill: '#EF4444', stroke: '#F87171', glow: 'rgba(239, 68, 68, 0.4)' },
  },
  done: {
    icon: CheckCircle2,
    lane: 'done',
    chipClass: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10',
    tint: 'text-emerald-400',
    map: { fill: '#10B981', stroke: '#34D399', glow: 'rgba(16, 185, 129, 0.35)' },
  },
};

export const goalStatusMeta = (status: string): GoalStatusMeta =>
  GOAL_STATUS_META[normalizeGoalStatus(status)];

type DevLifecycleT = Translations['plugins']['dev_lifecycle'];

/** Localized label for a status (canonical or raw). */
export function goalStatusLabel(dl: DevLifecycleT, status: string): string {
  switch (normalizeGoalStatus(status)) {
    case 'open':
      return dl.goal_status_open;
    case 'in-progress':
      return dl.goal_status_in_progress;
    case 'blocked':
      return dl.goal_status_blocked;
    case 'done':
      return dl.goal_status_done;
  }
}
