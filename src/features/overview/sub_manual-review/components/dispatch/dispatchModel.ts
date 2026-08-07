/**
 * dispatchModel.ts — pure view model behind the dispatch panel.
 *
 * The panel answers one question the app could not answer before: *what have I
 * approved, did it actually get sent, and is it going stale?* Three facts have
 * to meet to answer it, and each comes from a different place:
 *
 *  - the approved ideas themselves — the shared Backlog queue (`dev_ideas`);
 *  - which of them never became work — `dev_tools_undispatched_ideas`;
 *  - whether a project can even be handed to Fleet — its `root_path`.
 *
 * Merging them is the only real logic in the feature, so it lives here:
 * React-free, store-free, and unit-testable.
 */
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';
import type { AttentionThresholds } from '@/lib/bindings/AttentionThresholds';

import type { BacklogIdea } from '../backlog/backlogModel';

/** Why an idea cannot be handed to Fleet. `null` = it can. */
export type FleetBlock = 'no_project' | 'no_root_path';

/** One approved idea as the panel renders it. */
export interface DispatchRow {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  /** Resolved display name; '' when the idea is not project-scoped. */
  projectName: string;
  /**
   * Accepted, with no `dev_tasks` row. The headline signal — a decision that
   * never became work.
   */
  undispatched: boolean;
  /**
   * When the backend says the acceptance was written. `null` for a row with no
   * undispatched signal (it HAS a task, so "waiting since" means nothing).
   */
  acceptedAt: string | null;
  /**
   * Whole hours since acceptance, straight from the backend. `null` when the
   * stamp could not be parsed — never 0, which would read as "just now".
   */
  ageHours: number | null;
  fleetBlock: FleetBlock | null;
}

/**
 * Rail segment for an idea with no project. A real project name can never
 * collide with it (`FacetedDecisionTable` splits on `/`, and a name that were
 * literally this string would only mis-group with itself).
 */
export const NO_PROJECT_SEGMENT = '__no_project__';

/** Why Fleet cannot take this idea — or `null` when it can. */
export function fleetBlockFor(
  projectId: string | null,
  rootPathOf: (projectId: string) => string | null,
): FleetBlock | null {
  if (!projectId) return 'no_project';
  const root = rootPathOf(projectId);
  // A project the store cannot resolve is the same situation for the backend,
  // which reads the row itself and finds nothing to spawn against.
  if (root === null) return 'no_project';
  return root.trim() === '' ? 'no_root_path' : null;
}

/**
 * Merge the approved queue with the undispatched signal.
 *
 * The two lists are read with different limits and different filters, so they
 * are NOT guaranteed to cover each other. An undispatched idea that the
 * Backlog's page never loaded is exactly the row this panel exists to show —
 * dropping it because the other list is short would rebuild the bug. So the
 * signal's own fields render a row when the queue has none.
 */
export function buildDispatchRows(
  accepted: BacklogIdea[],
  signals: UndispatchedIdea[] | null,
  rootPathOf: (projectId: string) => string | null,
): DispatchRow[] {
  const signalById = new Map((signals ?? []).map((s) => [s.id, s]));
  const rows: DispatchRow[] = accepted.map((idea) => {
    const signal = signalById.get(idea.id);
    return {
      id: idea.id,
      title: idea.title,
      description: idea.description,
      projectId: idea.projectId,
      projectName: idea.projectName,
      undispatched: signal !== undefined,
      acceptedAt: signal?.acceptedAt ?? null,
      ageHours: signal?.ageHours ?? null,
      fleetBlock: fleetBlockFor(idea.projectId, rootPathOf),
    };
  });

  const seen = new Set(rows.map((r) => r.id));
  for (const signal of signals ?? []) {
    if (seen.has(signal.id)) continue;
    rows.push({
      id: signal.id,
      title: signal.title,
      description: '',
      projectId: signal.projectId,
      projectName: signal.projectName ?? '',
      undispatched: true,
      acceptedAt: signal.acceptedAt,
      ageHours: signal.ageHours,
      fleetBlock: fleetBlockFor(signal.projectId, rootPathOf),
    });
  }
  return rows;
}

/** Rail path: the project, or the explicit "no project" bucket. */
export function dispatchGroupPath(row: DispatchRow): string {
  return row.projectName || NO_PROJECT_SEGMENT;
}

/** Fields the panel's search box matches against. */
export function dispatchHaystack(row: DispatchRow): string[] {
  return [row.title, row.description, row.projectName];
}

/**
 * Past the threshold the BACKEND applied. Returns false when either the age or
 * the threshold is unknown — the panel says nothing about staleness rather
 * than inventing a cutoff of its own.
 */
export function isStale(row: DispatchRow, thresholds: AttentionThresholds | null): boolean {
  if (!thresholds || row.ageHours === null || !row.undispatched) return false;
  return row.ageHours >= thresholds.ideaDispatchDays * 24;
}

/** What the panel's header reports. */
export interface DispatchSummary {
  total: number;
  undispatched: number;
  stale: number;
}

export function summarizeDispatch(
  rows: DispatchRow[],
  thresholds: AttentionThresholds | null,
): DispatchSummary {
  let undispatched = 0;
  let stale = 0;
  for (const row of rows) {
    if (row.undispatched) undispatched += 1;
    if (isStale(row, thresholds)) stale += 1;
  }
  return { total: rows.length, undispatched, stale };
}

/**
 * Worst-first: never-dispatched before already-sent, then oldest, then title.
 * An unknown age sorts after a known one — it is not evidence of urgency.
 */
export function compareDispatch(a: DispatchRow, b: DispatchRow): number {
  if (a.undispatched !== b.undispatched) return a.undispatched ? -1 : 1;
  const ageA = a.ageHours ?? -1;
  const ageB = b.ageHours ?? -1;
  if (ageA !== ageB) return ageB - ageA;
  return a.title.localeCompare(b.title);
}

/**
 * The rows in a selection Fleet would refuse, so the panel can say so BEFORE
 * the click. The backend skips them with a per-item reason afterwards, which
 * is a worse place to learn it.
 */
export function fleetBlockedRows(rows: DispatchRow[], selectedIds: Set<string>): DispatchRow[] {
  return rows.filter((r) => selectedIds.has(r.id) && r.fleetBlock !== null);
}
