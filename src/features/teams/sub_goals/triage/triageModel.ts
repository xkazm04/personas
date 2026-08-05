// Goal Triage — the model behind the ONE goal-acceptance surface.
//
// Two hosts feed it and they start from different rows: the Mastermind canvas
// has `DevGoal`s for a single project, the title-bar tray has enriched
// `PendingAcceptanceGoal`s across every project. So this layer defines its own
// minimal shapes and each host adapts into them — nothing here imports a
// binding, a Factory model, or a canvas type.
import { goalStatusMeta, normalizeGoalStatus, type GoalLane, type GoalStatus } from '../goalStatus';

/** A KPI reduced to what a triage row renders. */
export interface GoalKpi {
  id: string;
  name: string;
  unit: string;
  /** null = no reading recorded; the gauge stays empty rather than faking 0%. */
  current: number | null;
  target: number;
  offTrack: boolean;
}

/** A goal reduced to what triage renders, independent of its source row. */
export interface TriageGoal {
  id: string;
  title: string;
  description: string | null;
  /** Raw status string — normalized here, never compared by callers. */
  status: string;
  /** 0–100. */
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  kpiId: string | null;
  projectId: string;
  /** Only set by the all-projects host; drives the project heading. */
  projectName?: string;
}

/** A goal plus everything a row needs, resolved once. */
export interface GoalRow {
  goal: TriageGoal;
  status: GoalStatus;
  lane: GoalLane;
  /** Accent for dots/chips — the canvas-native tint. */
  tint: string;
  kpi: GoalKpi | null;
  /** The user has to decide on this one. */
  awaiting: boolean;
}

/** Semantic ink per status. `GOAL_STATUS_META` carries Tailwind palette classes
 *  (`text-teal-300`), which can't be mixed into a `color-mix` wash and which
 *  CLAUDE.md bars from new UI — so the same five statuses map onto status
 *  tokens here instead. */
export const STATUS_INK: Record<GoalStatus, string> = {
  open: 'var(--status-info)',
  'in-progress': 'var(--status-warning)',
  awaiting_acceptance: 'var(--primary)',
  blocked: 'var(--status-error)',
  done: 'var(--status-success)',
};

export function toRows(goals: TriageGoal[], kpis: GoalKpi[]): GoalRow[] {
  const byId = new Map(kpis.map((k) => [k.id, k]));
  return goals.map((goal) => {
    const status = normalizeGoalStatus(goal.status);
    return {
      goal,
      status,
      lane: goalStatusMeta(status).lane,
      tint: STATUS_INK[status],
      kpi: goal.kpiId ? byId.get(goal.kpiId) ?? null : null,
      awaiting: status === 'awaiting_acceptance',
    };
  });
}

/** Rows bucketed by lane, awaiting-acceptance first within each bucket. */
export function byLane(rows: GoalRow[]): Map<GoalLane, GoalRow[]> {
  const out = new Map<GoalLane, GoalRow[]>([['your_turn', []], ['agent_turn', []], ['done', []]]);
  for (const r of rows) out.get(r.lane)?.push(r);
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.awaiting) - Number(a.awaiting) || a.goal.title.localeCompare(b.goal.title));
  }
  return out;
}

/** One rendered section: an optional project heading, an optional KPI, its rows.
 *  The per-project host leaves `project` null; the all-projects host sets it and
 *  the component prints a heading whenever it changes. */
export interface TriageBucket {
  project: string | null;
  kpi: GoalKpi | null;
  rows: GoalRow[];
}

/**
 * Bucket rows for display. Without `groupByProject` this is a flat KPI grouping
 * (the per-project modal); with it, buckets are ordered project-major and carry
 * the project name, so one component renders both hosts.
 */
export function bucketize(rows: GoalRow[], kpis: GoalKpi[], groupByProject = false): TriageBucket[] {
  if (!groupByProject) return kpiBuckets(rows, kpis, null);

  const byProject = new Map<string, GoalRow[]>();
  for (const r of rows) {
    const list = byProject.get(r.goal.projectId);
    if (list) list.push(r); else byProject.set(r.goal.projectId, [r]);
  }
  const out: TriageBucket[] = [];
  for (const [, group] of [...byProject.entries()].sort(
    ([, a], [, b]) => (a[0]?.goal.projectName ?? '').localeCompare(b[0]?.goal.projectName ?? ''),
  )) {
    out.push(...kpiBuckets(group, kpis, group[0]?.goal.projectName ?? null));
  }
  return out;
}

/** KPI sub-groups within one set of rows; the no-KPI bucket sorts last. */
function kpiBuckets(rows: GoalRow[], kpis: GoalKpi[], project: string | null): TriageBucket[] {
  const out: TriageBucket[] = [];
  for (const k of kpis) {
    const hit = rows.filter((r) => r.kpi?.id === k.id);
    if (hit.length) out.push({ project, kpi: k, rows: hit });
  }
  const loose = rows.filter((r) => !r.kpi);
  if (loose.length) out.push({ project, kpi: null, rows: loose });
  return out;
}

/** 0–100 progress toward the target, or null when there is no reading yet. */
export function kpiFill(kpi: GoalKpi): number | null {
  if (kpi.current == null || kpi.target === 0) return null;
  return Math.max(0, Math.min(100, (kpi.current / kpi.target) * 100));
}

/** "2h ago" from the DB's `YYYY-MM-DD HH:MM:SS` form. Empty when absent. */
export function relTime(iso: string | null): string {
  if (!iso) return '';
  const ts = new Date(iso.replace(' ', 'T')).getTime();
  if (!Number.isFinite(ts)) return '';
  const mins = Math.max(0, (Date.now() - ts) / 60000);
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}
