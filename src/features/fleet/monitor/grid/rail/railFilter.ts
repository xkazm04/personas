// railFilter — scoping the Activity rail to the one project column you clicked.
//
// The board is columns of teams; the rail beside it is everything waiting on
// you across ALL of them. On a board with twenty columns that pairing is the
// wrong way round for the commonest gesture there is: "this one — what does it
// need?". Clicking a column header answers it by narrowing all three tabs at
// once.
//
// ## The three tabs do not have the same handle on a project, and this file
// ## refuses to pretend they do
//
//   • MESSAGES scope by `teamId`, exactly. The merged feed is built from a list
//     of teams, so scoping is done by handing it a shorter list — nothing is
//     filtered at all, which is why nothing can be wrongly filtered.
//   • DISPATCH scope by `projectId`, exactly. `UndispatchedIdea` carries one,
//     and `DevProject.team_id` says which team owns the project. A row with no
//     project belongs to no column and is out of scope by construction.
//   • REVIEWS scope by NAME, because the unified triage queue has no project
//     id to scope by. `TriageItem.source` is `{ label, sublabel }` and what
//     lands there depends on the kind: a project name for a scanner idea, a
//     workspace name for a practice, a persona name for a held question or an
//     evolution proposal, a project name in the SUBLABEL for a finished goal,
//     and the literal "Self-tuning" for a policy proposal.
//
// So the review predicate is a set-membership test over the names that identify
// this column — the team, its projects, its personas — against both halves of
// the source. It is EXACT (after case-folding and trimming), never a substring:
// a substring test makes "API" match "Rapid API Review" and quietly rescopes
// the queue to something the operator did not click.
//
// WHAT THIS MEANS IN PRACTICE, stated because a filter that hides things is
// obliged to say so: a policy proposal (source "Self-tuning") and a practice
// raised against the workspace rather than a project match no column and are
// hidden by ANY project filter. That is a real limitation, not a rounding
// error, and it is why the rail paints a filter chip naming the scope for as
// long as one is applied — a scoped list the reader knows is scoped is a
// different thing from a list quietly missing rows.

import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

/**
 * One column's identity, in every form the three feeds can match on.
 *
 * Built by the board (which is the only thing that knows its own columns) and
 * handed to the rail whole, so the rail never has to ask the store what a team
 * is made of.
 */
export interface RailProjectFilter {
  /** The column's team. Messages scope by this and nothing else. */
  teamId: string;
  /** What the filter chip says. Already cleaned for display. */
  label: string;
  /** Ids of the `dev_projects` rows bound to this team. */
  projectIds: ReadonlySet<string>;
  /**
   * Lower-cased names that identify this column's work in a source label —
   * the team, its projects, its personas, in both raw and display forms.
   * Lower-cased at construction so the predicate does no work per row.
   */
  names: ReadonlySet<string>;
}

/** Fold a source label to the form `names` is keyed in. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

/** Does this triage item belong to the filtered column? See the header for
 *  why this is a name test and what it therefore cannot see. */
export function triageInScope(
  source: { label: string; sublabel?: string },
  filter: RailProjectFilter,
): boolean {
  if (filter.names.has(normalizeName(source.label))) return true;
  // The sublabel is where a finished goal puts its project name, so checking
  // only the label would drop the whole goal queue from every filtered view.
  return source.sublabel != null && filter.names.has(normalizeName(source.sublabel));
}

/** Does this accepted-but-undispatched idea belong to the filtered column? */
export function ideaInScope(row: UndispatchedIdea, filter: RailProjectFilter): boolean {
  // No project → no column. Not "everything", which is what a truthy-guard here
  // would silently mean.
  if (row.projectId != null) return filter.projectIds.has(row.projectId);
  // A project id is the reliable handle; the name is the fallback for rows the
  // backend could not resolve one for.
  return row.projectName != null && filter.names.has(normalizeName(row.projectName));
}
