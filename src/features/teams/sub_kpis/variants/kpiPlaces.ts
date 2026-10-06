// PLACES - the one addressable level a surface is currently reading.
//
// The module's grammar is a descent: portfolio to project inside the surface
// (`useKpiAltitude`), then the group layer, then the KPI. A derivation that
// hard-codes "project" can only be drawn at the top of that descent, which is
// the one-level defect the kpi-descent contest retired.
//
// So every round-4 concept takes PLACES and the surface decides the level.
// Two concepts already shared this through `assay/Assay.model`, which made
// the almanac import the assay - it lives here instead, where neither owns it.
import type { DevKpi } from '@/lib/bindings/DevKpi';

import type { Estate, EstateProject } from '../estate/kpiEstate';
import { UNGROUPED_KEY } from '../kpiOverviewModel';

export interface KpiPlace {
  /** What `descend`/`onFocus` will be given for this place. */
  id: string;
  label: string;
  kpis: DevKpi[];
}

/** The id a group with no `context_group_id` is addressed by - the same key
 *  `kpiOverviewModel` uses, so a focus built from a place resolves. */
export const UNGROUPED_PLACE = UNGROUPED_KEY;

/** Portfolio altitude: one place per project, in the estate's own ranking. */
export function projectPlaces(estate: Estate): KpiPlace[] {
  return estate.projects.map((p) => ({ id: p.projectId, label: p.label, kpis: p.kpis }));
}

/** Project altitude: one place per context group inside it. */
export function groupPlaces(project: EstateProject): KpiPlace[] {
  return project.groups.map((g) => ({ id: g.groupId ?? UNGROUPED_PLACE, label: g.label, kpis: g.kpis }));
}
