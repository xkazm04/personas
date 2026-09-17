// The ONE overview model every strategic KPI variant reads (kpi-strategic-map
// spark, 2026-09-17). Pure: no React, no store. A project is a lane, a context
// group is a cell, and a cell's BAND is a share ladder over the KPIs that were
// actually MEASURED — never over the ones that were not. Coverage (measured /
// total) travels beside the band so a green cell with 2 of 40 measured cannot
// pass for a green cell with 40 of 40 (registry: renormalize-over-present,
// unmeasurable-vs-zero).
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevProject } from '@/lib/bindings/DevProject';
import { kpiTrack, paceDescriptor } from './kpiMath';
import { distancePct } from './kpiDistance';

/** Cell/lane state. `unmeasured` = nothing measured, so nothing to say. */
export type KpiBand = 'met' | 'healthy' | 'mixed' | 'strained' | 'unmeasured';

/** Theme color per band — status hues carry status ONLY; `unmeasured` gets the
 *  muted tone and is drawn hatched (`HATCH_BG` in kpiChartTheme), never filled. */
export const BAND_COLOR: Record<KpiBand, string> = {
  met: 'var(--status-success)',
  healthy: 'var(--primary)',
  mixed: 'var(--status-warning)',
  strained: 'var(--status-error)',
  unmeasured: 'var(--muted-foreground)',
};

/** Worst first. `unmeasured` sorts LAST: it is not a verdict, and the map
 *  should read attention before absence. */
export const BAND_ORDER: KpiBand[] = ['strained', 'mixed', 'healthy', 'met', 'unmeasured'];
export function bandRank(b: KpiBand): number {
  return BAND_ORDER.indexOf(b);
}

/** Group key of the per-project cell holding KPIs with no `context_group_id`. */
export const UNGROUPED_KEY = 'ungrouped';

/** What a variant asks the dispatcher to open. `groupId: null` = the whole
 *  project; `UNGROUPED_KEY` = the project's ungrouped cell. */
export interface KpiFocus {
  projectId: string;
  groupId: string | null;
}

interface Counts {
  total: number;
  measured: number;
  met: number;
  onTrack: number;
  offTrack: number;
  unpaced: number;
}

export interface KpiGroupRollup extends Counts {
  /** `${projectId}:${groupId ?? UNGROUPED_KEY}` — stable across rebuilds. */
  key: string;
  projectId: string;
  groupId: string | null;
  label: string;
  domain: string | null;
  color: string | null;
  /** measured / total, 0..1. */
  coverage: number;
  /** offTrack / verdicts (met + onTrack + offTrack), or null with no verdict. */
  offTrackShare: number | null;
  band: KpiBand;
  kpis: DevKpi[];
}

export interface KpiProjectRollup extends Counts {
  projectId: string;
  label: string;
  groups: KpiGroupRollup[];
  /** The group read for this project FAILED: its KPIs are all in one
   *  "ungrouped" cell only because we could not see the groups. A failed read
   *  is not a grade — variants label the lane, they do not paint it. */
  groupsUnknown: boolean;
  coverage: number;
  offTrackShare: number | null;
  band: KpiBand;
}

const STRAINED_SHARE = 0.5;
const MIXED_SHARE = 0.25;

/** The share ladder. Verdicts = met + onTrack + offTrack; `unpaced` KPIs are
 *  measured but carry no verdict, so they count toward coverage and not toward
 *  the band. */
export function bandOf(c: Pick<Counts, 'measured' | 'met' | 'onTrack' | 'offTrack'>): KpiBand {
  if (c.measured === 0) return 'unmeasured';
  const verdicts = c.met + c.onTrack + c.offTrack;
  if (verdicts === 0) return 'unmeasured';
  const share = c.offTrack / verdicts;
  if (share >= STRAINED_SHARE) return 'strained';
  if (share >= MIXED_SHARE) return 'mixed';
  return c.met === verdicts ? 'met' : 'healthy';
}

function offTrackShareOf(c: Counts): number | null {
  const verdicts = c.met + c.onTrack + c.offTrack;
  return verdicts === 0 ? null : c.offTrack / verdicts;
}

function countKpis(kpis: DevKpi[]): Counts {
  const c: Counts = { total: kpis.length, measured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0 };
  for (const k of kpis) {
    const t = kpiTrack(k);
    if (t === 'unmeasured') continue;
    c.measured += 1;
    if (t === 'met') c.met += 1;
    else if (t === 'on-track') c.onTrack += 1;
    else if (t === 'off-track') c.offTrack += 1;
    else c.unpaced += 1;
  }
  return c;
}

export function groupKey(projectId: string, groupId: string | null): string {
  return `${projectId}:${groupId ?? UNGROUPED_KEY}`;
}

/**
 * Active KPIs → one rollup per project (worst band first, then label), each
 * holding one rollup per context group (worst first, then label) plus one
 * "ungrouped" cell when any KPI has no group. `ungroupedLabel` is the i18n'd
 * cell name; `failedProjectIds` marks lanes whose group read failed.
 */
export function buildOverview(
  kpis: DevKpi[],
  projects: DevProject[],
  groups: DevContextGroup[],
  ungroupedLabel: string,
  failedProjectIds: ReadonlySet<string> = new Set(),
): KpiProjectRollup[] {
  const projectName = new Map(projects.map((p) => [p.id, p.name] as const));
  const groupById = new Map(groups.map((g) => [g.id, g] as const));
  const byProject = new Map<string, Map<string | null, DevKpi[]>>();
  for (const k of kpis) {
    if (k.status !== 'active') continue;
    let cells = byProject.get(k.project_id);
    if (!cells) { cells = new Map(); byProject.set(k.project_id, cells); }
    // A group id the read did not return is treated as ungrouped: the KPI
    // still counts, it just cannot be placed.
    const gid = k.context_group_id && groupById.has(k.context_group_id) ? k.context_group_id : null;
    let list = cells.get(gid);
    if (!list) { list = []; cells.set(gid, list); }
    list.push(k);
  }
  const out: KpiProjectRollup[] = [];
  for (const [projectId, cells] of byProject) {
    const groupRollups: KpiGroupRollup[] = [];
    for (const [gid, list] of cells) {
      const g = gid ? groupById.get(gid) : undefined;
      const c = countKpis(list);
      groupRollups.push({
        ...c,
        key: groupKey(projectId, gid),
        projectId,
        groupId: gid,
        label: g?.name ?? ungroupedLabel,
        domain: g?.domain ?? null,
        color: g?.color ?? null,
        coverage: c.total === 0 ? 0 : c.measured / c.total,
        offTrackShare: offTrackShareOf(c),
        band: bandOf(c),
        kpis: list,
      });
    }
    groupRollups.sort((a, b) => bandRank(a.band) - bandRank(b.band) || a.label.localeCompare(b.label));
    const all = groupRollups.flatMap((g) => g.kpis);
    const c = countKpis(all);
    out.push({
      ...c,
      projectId,
      label: projectName.get(projectId) ?? '—',
      groups: groupRollups,
      groupsUnknown: failedProjectIds.has(projectId),
      coverage: c.total === 0 ? 0 : c.measured / c.total,
      offTrackShare: offTrackShareOf(c),
      band: bandOf(c),
    });
  }
  out.sort((a, b) => bandRank(a.band) - bandRank(b.band) || a.label.localeCompare(b.label));
  return out;
}

/** Find a group rollup by focus; null when the project or group is gone. */
export function findGroup(overview: KpiProjectRollup[], focus: KpiFocus): KpiGroupRollup | null {
  const p = overview.find((x) => x.projectId === focus.projectId);
  if (!p) return null;
  const gid = focus.groupId === UNGROUPED_KEY ? null : focus.groupId;
  return p.groups.find((g) => g.groupId === gid) ?? null;
}

/**
 * The ONE ranked next move for a project (registry: single-ranked-next-move):
 * the off-track KPI with the largest shortfall × urgency. Shortfall is the
 * unmet distance to target (0..1); urgency doubles at/after the target date
 * and decays toward 1 as the date recedes. Null when nothing is off-track.
 */
export function rankNextMove(p: KpiProjectRollup): DevKpi | null {
  let best: DevKpi | null = null;
  let bestScore = -1;
  for (const g of p.groups) {
    for (const k of g.kpis) {
      const d = paceDescriptor(k);
      if (d.track !== 'off-track') continue;
      const pct = distancePct(k);
      const shortfall = pct == null ? 1 : Math.max(0, 1 - Math.min(100, pct) / 100);
      const urgency =
        d.daysLeft == null ? 1 : d.daysLeft <= 0 ? 2 : 1 + 1 / (1 + d.daysLeft / 30);
      const score = shortfall * urgency;
      if (score > bestScore) { bestScore = score; best = k; }
    }
  }
  return best;
}
