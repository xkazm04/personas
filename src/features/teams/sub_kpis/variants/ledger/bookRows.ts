// Which rows the ledger's page is showing, at whichever altitude it is at.
//
// One function, because the page must never be assembled twice: the ranking,
// the context line and the rank number are the same at every level, and that
// sameness is what lets a reader descend without relearning the page.
import type { Estate, EstateProject } from '../../estate/kpiEstate';
import { sortByAttention, tallyKpis } from '../../estate/kpiEstate';
import { debtsOf, type BookRow } from './kpiBooks';

export function projectRows(estate: Estate): BookRow[] {
  return sortByAttention(estate.projects).map((p, i) => ({
    id: p.projectId,
    kind: 'project' as const,
    rank: i + 1,
    label: p.label,
    context: null,
    projectId: p.projectId,
    groupId: null,
    tally: p.tally,
    debts: debtsOf(p.tally),
    lastReadAt: p.tally.lastReadAt,
  }));
}

export function groupRows(project: EstateProject): BookRow[] {
  return sortByAttention(project.groups).map((g, i) => ({
    id: g.key,
    kind: 'group' as const,
    rank: i + 1,
    label: g.label,
    context: project.label,
    projectId: g.projectId,
    groupId: g.groupId,
    tally: g.tally,
    debts: debtsOf(g.tally),
    lastReadAt: g.tally.lastReadAt,
  }));
}

export function rowsFor(estate: Estate, project: EstateProject | null): BookRow[] {
  return project ? groupRows(project) : projectRows(estate);
}

/** The rows one level BELOW a row, for the preview pane - the same shape, so
 *  the preview is the page the reader is about to get, not a summary of it. */
export function childRows(estate: Estate, row: BookRow, limit = 5): BookRow[] {
  if (row.kind !== 'project') return [];
  const project = estate.projects.find((p) => p.projectId === row.projectId);
  return project ? groupRows(project).slice(0, limit) : [];
}

/** A single KPI as a row, so the deepest preview speaks the same language. */
export function kpiRows(estate: Estate, projectId: string, groupId: string | null, limit = 5): BookRow[] {
  const project = estate.projects.find((p) => p.projectId === projectId);
  const group = project?.groups.find((g) => g.groupId === groupId);
  if (!group) return [];
  return group.kpis.slice(0, limit).map((k, i) => {
    const tally = tallyKpis([k], estate.now);
    return {
      id: k.id,
      kind: 'kpi' as const,
      rank: i + 1,
      label: k.name,
      context: group.label,
      projectId,
      groupId,
      tally,
      debts: debtsOf(tally),
      lastReadAt: tally.lastReadAt,
    };
  });
}
