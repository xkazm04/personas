// WHO WANTS A HUMAN — the ranked shortlist every surface prints beside the
// estate, and the numbers that pin a name to a place on the map.
//
// Two rules the contest's winning entry earned:
//
//  * A shortlist spread across owners beats a deeper one. The largest project
//    here holds 721 of 1,044 KPIs and would otherwise take every slot, so a
//    portfolio pick is capped per project: the list answers "where in the
//    estate", not "inside the biggest thing".
//  * The rank is printed in the list AND on the canvas. A name found in one
//    has a findable place in the other (contest pattern
//    `rank-gives-a-name-a-place`).
import type { DevKpi } from '@/lib/bindings/DevKpi';

import type { Estate, EstateProject, KpiTally } from './kpiEstate';
import { kpiAttention, sortByAttention, tallyKpis } from './kpiEstate';

export interface AttentionPick {
  /** Stable across rebuilds — a group key, or a project id. */
  id: string;
  /** 1-based, and the same number the canvas paints. */
  rank: number;
  label: string;
  /** Where it sits, when the list spans more than one owner. */
  context: string | null;
  projectId: string;
  /** null for a whole project, a group id (or the ungrouped key) otherwise. */
  groupId: string | null;
  tally: KpiTally;
}

export interface PickOptions {
  /** How many rows the rail has room for. */
  limit?: number;
  /** At most this many picks from one project (portfolio altitude only). */
  perProject?: number;
}

/** A place nobody needs to look at does not belong on a shortlist. */
function wantsAHuman(tally: KpiTally): boolean {
  return tally.attention > 0;
}

/**
 * The portfolio shortlist: the groups that most want a human, spread across
 * projects. Groups rather than projects, because "personas needs you" is not
 * an instruction and "personas › Plugin Ecosystem, 131 KPIs, never read" is.
 */
export function portfolioPicks(estate: Estate, { limit = 8, perProject = 2 }: PickOptions = {}): AttentionPick[] {
  const all = estate.projects.flatMap((p) =>
    p.groups.filter((g) => wantsAHuman(g.tally)).map((g) => ({ project: p, group: g })),
  );
  all.sort(
    (a, b) =>
      b.group.tally.attention - a.group.tally.attention ||
      b.group.tally.total - a.group.tally.total ||
      a.group.label.localeCompare(b.group.label),
  );
  const taken = new Map<string, number>();
  const out: AttentionPick[] = [];
  for (const { project, group } of all) {
    if (out.length >= limit) break;
    const used = taken.get(project.projectId) ?? 0;
    if (used >= perProject) continue;
    taken.set(project.projectId, used + 1);
    out.push({
      id: group.key,
      rank: out.length + 1,
      label: group.label,
      context: project.label,
      projectId: project.projectId,
      groupId: group.groupId,
      tally: group.tally,
    });
  }
  return out;
}

/** The same shortlist one altitude down: the groups inside one project. */
export function projectPicks(project: EstateProject, { limit = 8 }: PickOptions = {}): AttentionPick[] {
  return sortByAttention(project.groups.filter((g) => wantsAHuman(g.tally)))
    .slice(0, limit)
    .map((group, i) => ({
      id: group.key,
      rank: i + 1,
      label: group.label,
      context: null,
      projectId: project.projectId,
      groupId: group.groupId,
      tally: group.tally,
    }));
}

export function picksFor(estate: Estate, project: EstateProject | null, options?: PickOptions): AttentionPick[] {
  return project ? projectPicks(project, options) : portfolioPicks(estate, options);
}

export interface CheapWin {
  kpi: DevKpi;
  /** How many KPIs in the same group are stale for the same cadence — one
   *  visit to that measurement restores all of them. */
  alsoRestores: number;
  groupLabel: string;
}

/**
 * The cheapest restorations in scope: a KPI that HAS been read and has simply
 * gone stale needs no new instrumentation, only a re-measure, and it usually
 * travels with siblings on the same cadence. Ranked by how many KPIs one visit
 * brings back.
 */
export function cheapWins(
  project: EstateProject | null,
  estate: Estate,
  now: number,
  limit = 3,
): CheapWin[] {
  const groups = project ? project.groups : estate.projects.flatMap((p) => p.groups);
  const out: CheapWin[] = [];
  for (const group of groups) {
    const stale = group.kpis.filter((k) => kpiAttention(k, now) > 0 && tallyKpis([k], now).stale === 1);
    if (stale.length === 0) continue;
    const first = [...stale].sort((a, b) => a.name.localeCompare(b.name))[0]!;
    out.push({ kpi: first, alsoRestores: stale.length, groupLabel: group.label });
  }
  return out.sort((a, b) => b.alsoRestores - a.alsoRestores || a.kpi.name.localeCompare(b.kpi.name)).slice(0, limit);
}
