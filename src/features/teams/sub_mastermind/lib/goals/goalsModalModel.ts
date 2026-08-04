// Shared model for the Mastermind Goals modal variants.
//
// The middleground the prototype is looking for: GoalListPopover showed ONE
// project's ongoing goal TITLES and nothing else; the acceptance queue
// (sub_goals/AcceptanceTriagePolished) showed EVERY project's awaiting-acceptance
// goals with full accept/reject machinery. Neither answers "what is happening
// with goals on THIS project, and what needs me?" — so the fused surface is
// project-scoped (like the popover) but action-carrying (like the queue), and
// covers every lane, not just the awaiting one.
//
// Every variant consumes this identical `GoalsModalProps`; the page builds it
// once. KPIs arrive pre-reduced as `KpiListItem` (the same shape KpiListPopover
// takes) so this layer stays free of the Factory model.
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { goalStatusMeta, normalizeGoalStatus, type GoalLane, type GoalStatus } from '@/features/teams/sub_goals/goalStatus';

import type { KpiListItem } from '../KpiListPopover';

export interface GoalsModalProps {
  projectName: string;
  /** Every goal on the project, any status. */
  goals: DevGoal[];
  /** The project's KPIs, worst-first (KpiListPopover's row shape). */
  kpis: KpiListItem[];
  /** Ids with an accept/reject in flight — rows disable while resolving. */
  busyIds: Set<string>;
  onAccept: (goalId: string) => void;
  onReject: (goalId: string, comment: string) => void;
  /** Bulk accept — one refetch for N accepts, not N racing refetch cycles. */
  onAcceptAll: (goalIds: string[]) => void;
}

/** A goal plus everything a row needs, resolved once. */
export interface GoalRow {
  goal: DevGoal;
  status: GoalStatus;
  lane: GoalLane;
  /** Accent for dots/chips — the canonical per-status tint. */
  tint: string;
  /** The KPI this goal serves, when it serves a measured one. */
  kpi: KpiListItem | null;
  /** The user has to decide on this one. */
  awaiting: boolean;
}

export function toRows(goals: DevGoal[], kpis: KpiListItem[]): GoalRow[] {
  const byKpi = new Map(kpis.map((k) => [k.id, k]));
  return goals.map((goal) => {
    const status = normalizeGoalStatus(goal.status);
    const meta = goalStatusMeta(status);
    return {
      goal,
      status,
      lane: meta.lane,
      tint: STATUS_INK[status],
      kpi: goal.kpi_id ? byKpi.get(goal.kpi_id) ?? null : null,
      awaiting: status === 'awaiting_acceptance',
    };
  });
}

/** Canvas-native ink per status. GOAL_STATUS_META carries Tailwind palette
 *  classes (`text-teal-300`), which the canvas can't mix into SVG/`color-mix`
 *  washes and which CLAUDE.md bars from new UI — so the modal maps the same
 *  five statuses onto semantic status tokens instead. */
export const STATUS_INK: Record<GoalStatus, string> = {
  open: 'var(--status-info)',
  'in-progress': 'var(--status-warning)',
  awaiting_acceptance: 'var(--primary)',
  blocked: 'var(--status-error)',
  done: 'var(--status-success)',
};

/** Lane display order + copy. `your_turn` first: the modal opens on the thing
 *  that needs a human. */
export const LANES: readonly { id: GoalLane; label: string; blurb: string }[] = [
  { id: 'your_turn', label: 'Your turn', blurb: 'Waiting on a decision, unstarted, or blocked.' },
  { id: 'agent_turn', label: 'In flight', blurb: 'A team is working on these right now.' },
  { id: 'done', label: 'Done', blurb: 'Accepted and off the board.' },
];

/** Rows bucketed by lane, awaiting-acceptance first within each bucket (the
 *  actionable ones float to the top of the list they live in). */
export function byLane(rows: GoalRow[]): Map<GoalLane, GoalRow[]> {
  const out = new Map<GoalLane, GoalRow[]>([['your_turn', []], ['agent_turn', []], ['done', []]]);
  for (const r of rows) out.get(r.lane)?.push(r);
  for (const list of out.values()) {
    list.sort((a, b) =>
      Number(b.awaiting) - Number(a.awaiting)
      || a.goal.title.localeCompare(b.goal.title));
  }
  return out;
}

/** KPI sub-groups within a set of rows; the no-KPI bucket sorts last. */
export interface KpiBucket { kpi: KpiListItem | null; rows: GoalRow[] }

export function byKpi(rows: GoalRow[], kpis: KpiListItem[]): KpiBucket[] {
  const buckets: KpiBucket[] = [];
  for (const k of kpis) {
    const hit = rows.filter((r) => r.kpi?.id === k.id);
    if (hit.length) buckets.push({ kpi: k, rows: hit });
  }
  const loose = rows.filter((r) => !r.kpi);
  if (loose.length) buckets.push({ kpi: null, rows: loose });
  return buckets;
}

/** 0–100 progress toward a KPI's target, or null when it has no reading yet.
 *  Mirrors the acceptance queue's gauge without needing a full DevKpi row. */
export function kpiFill(kpi: KpiListItem): number | null {
  if (kpi.current == null || kpi.target === 0) return null;
  return Math.max(0, Math.min(100, (kpi.current / kpi.target) * 100));
}

/** "2h ago" from the DB's `YYYY-MM-DD HH:MM:SS` form. Empty when absent. */
export function relTime(iso: string | null): string {
  if (!iso) return '';
  const ts = new Date(iso.replace(' ', 'T')).getTime();
  if (!Number.isFinite(ts)) return '';
  const mins = Math.max(0, (Date.now() - ts) / 60000);
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
