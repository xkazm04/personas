/**
 * Busbar's reading of the shared Progress model: which project leads, what
 * letter it answers to, and how each project's goals hang from its milestone
 * rails. Pure - no React, no fetching - so the layout files only draw.
 *
 * Ported from the goals-filmstrip-r2 winner (B/3, "Busbar"). Its colours were
 * literal hex; here every ink is a theme token, so the eleven themes repaint
 * it and the light themes get a legible rail without a second palette.
 */
import type { DevGoal } from '@/lib/bindings/DevGoal';

import { isComplete, normalizeGoalStatus, type GoalStatus } from '../../../goalStatus';
import type { MilestoneLane } from '../../milestoneOps';
import type { ProgressNode, ProgressRow } from '../../useProgressModel';

/**
 * Rail inks, by the milestone's NUMBER. Busbar's central idea is that a rail
 * is identified by colour and digit together (the digit is also the key that
 * binds to it), so the colour is categorical on purpose. The cut STATE is not
 * lost: the terminal's plan / cut / ship ladder carries it.
 */
const RAIL_INKS = [
  'var(--brand-cyan)',
  'var(--brand-purple)',
  'var(--brand-rose)',
  'var(--brand-emerald)',
  'var(--brand-amber)',
] as const;

/** The open bus (no milestone) is drawn in the ink of the text, half strength. */
export const OPEN_BUS_INK = 'color-mix(in srgb, var(--foreground) 50%, transparent)';

export function railInk(number: number): string {
  return number <= 0 ? OPEN_BUS_INK : RAIL_INKS[(number - 1) % RAIL_INKS.length]!;
}

/** A goal status as a CSS colour, for the figure parts a class cannot reach
 *  (bracket borders, meter cells, hex fills). Same meanings as GOAL_STATUS_META. */
const STATUS_INK: Record<GoalStatus, string> = {
  open: 'var(--status-info)',
  'in-progress': 'var(--status-warning)',
  awaiting_acceptance: 'var(--role-highlight)',
  blocked: 'var(--status-error)',
  done: 'var(--status-success)',
};

export function statusInk(status: string): string {
  return STATUS_INK[normalizeGoalStatus(status)];
}

/** A done goal reads as complete whatever its stored progress says. */
export function goalPct(g: DevGoal): number {
  return isComplete(g.status) ? 100 : Math.min(100, Math.max(0, Math.round(g.progress)));
}

export interface BusGoal {
  node: ProgressNode;
  /** 1-based position down the sheet - the card's `#NN`. */
  number: number;
  /** Hangs from its parent goal on an elbow instead of from the rail. */
  sub: boolean;
}

export interface BusBand {
  key: string;
  /** `null` = the open bus (goals bound to no milestone). */
  lane: MilestoneLane | null;
  /** 1-based rail number (the bind key); 0 for the open bus. */
  number: number;
  goals: BusGoal[];
  /** Over every goal on the rail, including those the done-filter hides. */
  total: number;
  done: number;
  avg: number;
}

export interface BusProject {
  row: ProgressRow;
  /** The jump letter, `g` then this. Empty past the 26th project. */
  letter: string;
  bands: BusBand[];
  /** Visible goal ids in sheet order - the cursor's track. */
  order: string[];
  laneCount: number;
  unassigned: number;
  avg: number;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function byOrder(a: ProgressNode, b: ProgressNode): number {
  return a.goal.order_index - b.goal.order_index || a.goal.created_at.localeCompare(b.goal.created_at);
}

/** Parents first, their sub-goals right after them, each walked once. */
function hang(nodes: ProgressNode[]): Array<{ node: ProgressNode; sub: boolean }> {
  const sorted = [...nodes].sort(byOrder);
  const here = new Set(sorted.map((n) => n.goal.id));
  const kids = new Map<string, ProgressNode[]>();
  const roots: ProgressNode[] = [];
  for (const n of sorted) {
    const p = n.goal.parent_goal_id;
    if (p && p !== n.goal.id && here.has(p)) {
      const list = kids.get(p);
      if (list) list.push(n);
      else kids.set(p, [n]);
    } else roots.push(n);
  }
  const out: Array<{ node: ProgressNode; sub: boolean }> = [];
  const seen = new Set<string>();
  const walk = (list: ProgressNode[], depth: number) => {
    for (const n of list) {
      if (seen.has(n.goal.id)) continue;
      seen.add(n.goal.id);
      out.push({ node: n, sub: depth > 0 });
      walk(kids.get(n.goal.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  // A parent cycle leaves nodes no root reaches; they still get a card.
  for (const n of sorted) if (!seen.has(n.goal.id)) out.push({ node: n, sub: false });
  return out;
}

function stats(goals: readonly DevGoal[]) {
  const done = goals.filter((g) => isComplete(g.status)).length;
  const avg = goals.length ? Math.round(goals.reduce((s, g) => s + goalPct(g), 0) / goals.length) : 0;
  return { total: goals.length, done, avg };
}

/**
 * Projects in sheet order. Busbar's own decision: a project that HAS
 * milestones and live work leads, because that is a sheet with rails to work
 * on; then the model's busiest-first order.
 */
export function buildProjects(
  rows: readonly ProgressRow[],
  lanesByProject: ReadonlyMap<string, MilestoneLane[]> | null,
  allGoals: readonly DevGoal[],
): BusProject[] {
  const everyGoal = new Map(allGoals.map((g) => [g.id, g]));
  const lead = (r: ProgressRow) => ((lanesByProject?.get(r.projectId)?.length ?? 0) > 0 && r.activeCount > 0 ? 1 : 0);
  const ordered = [...rows].sort((a, b) => lead(b) - lead(a));

  return ordered.map((row, i) => {
    const lanes = lanesByProject?.get(row.projectId) ?? [];
    const projectGoals = allGoals.filter((g) => g.project_id === row.projectId);
    const bound = new Set(lanes.flatMap((l) => [...l.goalIds]));
    const bands: BusBand[] = lanes.map((lane, li) => ({
      key: lane.id,
      lane,
      number: li + 1,
      goals: [],
      ...stats([...lane.goalIds].map((id) => everyGoal.get(id)).filter((g): g is DevGoal => !!g)),
    }));
    const open: BusBand = {
      key: `${row.projectId}:open`,
      lane: null,
      number: 0,
      goals: [],
      ...stats(projectGoals.filter((g) => !bound.has(g.id))),
    };

    const laneOf = new Map<string, BusBand>();
    for (const band of bands) for (const id of band.lane!.goalIds) if (!laneOf.has(id)) laneOf.set(id, band);
    const perBand = new Map<BusBand, ProgressNode[]>();
    for (const n of row.nodes) {
      const band = laneOf.get(n.goal.id) ?? open;
      const list = perBand.get(band);
      if (list) list.push(n);
      else perBand.set(band, [n]);
    }

    const all = [...bands, open];
    const order: string[] = [];
    for (const band of all) {
      band.goals = hang(perBand.get(band) ?? []).map(({ node, sub }) => {
        order.push(node.goal.id);
        return { node, sub, number: order.length };
      });
    }

    return {
      row,
      letter: LETTERS[i] ?? '',
      // The open bus only when something is (or could be shown) on it.
      bands: open.total > 0 || bands.length === 0 ? all : bands,
      order,
      laneCount: lanes.length,
      unassigned: open.total,
      avg: stats(projectGoals).avg,
    };
  });
}

/** The band a goal currently hangs from, within one project. */
export function bandOfGoal(project: BusProject, goalId: string): BusBand | null {
  return project.bands.find((b) => b.goals.some((g) => g.node.goal.id === goalId)) ?? null;
}
