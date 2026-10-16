/**
 * The Ledger's Board-inherited signals as pure functions: whose turn a goal is,
 * the row rail that says so, and the completion fill. No React, so the mapping
 * is unit-testable without a table.
 *
 * The turn glyph is the non-colour signal (shape: person / bot / check); the rail
 * and tint only repeat it.
 */
import { Bot, CheckCircle2, User } from 'lucide-react';
import type { ComponentType } from 'react';

import type { ChecklistCount } from '../shared/useGoalChecklistCounts';
import { GOAL_STATUS_META, isComplete, normalizeGoalStatus, type GoalLane } from '../goalStatus';

export interface LaneSignal {
  icon: ComponentType<{ className?: string }>;
  tint: string;
  /** Left-rail class for the table row, or undefined for no rail. */
  rail: string | undefined;
  /** Key into t.plugins.dev_tools for the Tooltip label. */
  labelKey: 'your_turn' | 'agents_turn' | 'done';
}

export const LANE_SIGNAL: Record<GoalLane, LaneSignal> = {
  your_turn: { icon: User, tint: 'text-amber-400', rail: 'border-l-amber-400/70', labelKey: 'your_turn' },
  agent_turn: { icon: Bot, tint: 'text-blue-400', rail: 'border-l-blue-400/70', labelKey: 'agents_turn' },
  done: { icon: CheckCircle2, tint: 'text-emerald-400', rail: undefined, labelKey: 'done' },
};

export function laneSignal(status: string): LaneSignal {
  return LANE_SIGNAL[GOAL_STATUS_META[normalizeGoalStatus(status)].lane];
}

/** Overdue red wins, but only while the goal is not done; otherwise the turn rail. */
export function ledgerRail(status: string, overdue: boolean): string | undefined {
  if (overdue && !isComplete(status)) return 'border-l-status-error/70';
  return laneSignal(status).rail;
}

/** Board rule: a checklist drives the percent when there is one, else manual progress. */
export function ledgerFillPct(counts: ChecklistCount | undefined, progress: number | null | undefined): number {
  const raw = counts && counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : (progress ?? 0);
  return Math.min(100, Math.max(0, raw));
}

/** Board colours: emerald when a checklist drives the fill, violet for manual progress. */
export function ledgerFillColor(counts: ChecklistCount | undefined): string {
  return counts && counts.total > 0 ? 'rgba(16,185,129,0.16)' : 'rgba(139,92,246,0.14)';
}
