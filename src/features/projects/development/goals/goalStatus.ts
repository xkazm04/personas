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
import { Circle, Clock, AlertCircle, CheckCircle2, BadgeCheck } from 'lucide-react';
import type { Translations } from '@/i18n/en';

/** The canonical dev-goal statuses (hyphen form — what the DB persists).
 *  `awaiting_acceptance` = agent/team finished the work; it sits in the
 *  human-acceptance queue (Your-turn lane) until the user accepts (→ done) or
 *  rejects (→ in-progress). */
export type GoalStatus = 'open' | 'in-progress' | 'awaiting_acceptance' | 'blocked' | 'done';

export const GOAL_STATUSES: readonly GoalStatus[] = ['open', 'in-progress', 'awaiting_acceptance', 'blocked', 'done'];

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
    case 'awaiting_acceptance':
    case 'awaiting-acceptance':
    case 'pending_acceptance':
      return 'awaiting_acceptance';
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
/** Agent-completed, waiting on the user to accept or reject. */
export const isAwaitingAcceptance = (s: string): boolean => normalizeGoalStatus(s) === 'awaiting_acceptance';
/** Not terminal — counts as active work (drives at-risk rollups + the Timeline). */
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
    chipClass: 'text-status-info border-status-info/25 bg-status-info/10',
    tint: 'text-status-info',
    map: { fill: '#3B82F6', stroke: '#60A5FA', glow: 'rgba(59, 130, 246, 0.35)' },
  },
  'in-progress': {
    icon: Clock,
    lane: 'agent_turn',
    chipClass: 'text-status-warning border-status-warning/25 bg-status-warning/10',
    tint: 'text-status-warning',
    map: { fill: '#F59E0B', stroke: '#FBBF24', glow: 'rgba(245, 158, 11, 0.4)' },
  },
  // Agent finished; the user's turn to accept/reject. Distinct teal so it reads
  // as a call-to-action, not "done" (emerald) nor "blocked" (red).
  awaiting_acceptance: {
    icon: BadgeCheck,
    lane: 'your_turn',
    chipClass: 'text-role-external border-role-external/25 bg-role-external/10',
    tint: 'text-role-external',
    map: { fill: '#2DD4BF', stroke: '#5EEAD4', glow: 'rgba(45, 212, 191, 0.4)' },
  },
  blocked: {
    icon: AlertCircle,
    lane: 'your_turn',
    chipClass: 'text-status-error border-status-error/25 bg-status-error/10',
    tint: 'text-status-error',
    map: { fill: '#EF4444', stroke: '#F87171', glow: 'rgba(239, 68, 68, 0.4)' },
  },
  done: {
    icon: CheckCircle2,
    lane: 'done',
    chipClass: 'text-status-success border-status-success/25 bg-status-success/10',
    tint: 'text-status-success',
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
    case 'awaiting_acceptance':
      return dl.goal_status_awaiting_acceptance;
    case 'blocked':
      return dl.goal_status_blocked;
    case 'done':
      return dl.goal_status_done;
  }
}
