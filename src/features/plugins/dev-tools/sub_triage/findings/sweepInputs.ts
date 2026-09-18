// The two sweep inputs both entry points were omitting (dev-findings-loop §3 2B,
// E2 + E5).
//
// `SweepInputs.plan` and `SweepInputs.kpiAttention` are optional, and
// `runFindingSweep` runs the `passport_gap` emitter only when `plan` is present
// and the `kpi_offtrack` emitter only when `kpiAttention` is SUPPLIED. Neither
// SweepButton nor `runHealthIngest` supplied either, so two declared sensors
// were decorative: the scoreboard could never score them, and the skipped list
// did not name them because the sweep did not even consider them skipped.
//
// The comment in SweepButton said these "need Factory-side state that lives on
// another route". They need the DATA, not the route — and both pieces are
// derivable headlessly:
//
//  * the plan is a pure function of the project's passport, which both callers
//    already hold (`planItemsForPassport`, extracted from `buildImprovePlan`);
//  * the off-track KPI set is the same four reads the Factory provider does per
//    project, folded by the SAME `assembleProject` + `collectKpiAttention` pair
//    the wall badges use — so the sweep and the badge can never disagree about
//    what "off track" means.
//
// The honesty rule both gatherers obey: `undefined` means THE SENSOR COULD NOT
// READ (the sweep then names it skipped), `[]` means read-and-all-on-track — a
// real probe that may clear a standing finding. They are never collapsed.
import * as devApi from '@/api/devTools/devTools';
import * as kpiApi from '@/api/devTools/kpis';
import * as useCaseApi from '@/api/devTools/useCases';
import { assembleProject } from '@/features/teams/sub_factory/factoryData';
import { collectKpiAttention } from '@/features/teams/sub_factory/factoryModel';
import { planItemsForPassport } from '@/features/teams/sub_factory/passport/improve/improvePlan';
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';
import type { PlanItem } from '@/features/teams/sub_factory/passport/improve/improvePlan';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import { silentCatch } from '@/lib/silentCatch';

import type { KpiAttention } from './types';

/** Measurement points per KPI folded into the trend series. Same depth the
 *  Factory provider uses, so `kpiStatus` sees the same numbers. */
const SERIES_DEPTH = 20;

/** This project's below-target passport dimensions as plan items.
 *  Pure — the caller already paid for the passport. */
export function planForProject(
  passport: AppPassport,
  project: { id: string; name: string },
): PlanItem[] {
  return planItemsForPassport(passport, project);
}

/**
 * Every KPI on the project currently in `crit`, read headlessly.
 *
 * @returns the off-track set (possibly empty — a probe), or `undefined` when the
 *   KPI tree could not be read at all. `undefined` is the sweep's cue to name
 *   `kpi` in `skippedSensors` rather than fake-clear standing findings.
 */
export async function collectProjectKpiAttention(
  project: { id: string; name: string; tech_stack: string | null },
): Promise<KpiAttention[] | undefined> {
  try {
    const [groups, contexts, useCases, kpis] = await Promise.all([
      devApi.listContextGroups(project.id),
      devApi.listContexts(project.id),
      useCaseApi.listUseCases(project.id),
      kpiApi.listKpis(project.id),
    ]);
    // Managed KPIs only, exactly as the matrix filters them: a proposed KPI has
    // no agreed target, so calling it off-track would be an invented verdict.
    const managed = kpis.filter((k) => k.status === 'active' || k.status === 'paused');
    const ids = managed.map((k) => k.id);
    const measurements: DevKpiMeasurement[] = ids.length
      ? await kpiApi.listKpiMeasurementsBulk(ids, SERIES_DEPTH)
      : [];
    const seriesByKpi = new Map<string, number[]>();
    for (const m of measurements) {
      const arr = seriesByKpi.get(m.kpi_id) ?? seriesByKpi.set(m.kpi_id, []).get(m.kpi_id)!;
      arr.push(m.value);
    }
    for (const [, arr] of seriesByKpi) arr.reverse(); // bulk is newest-first
    const assembled = assembleProject(project, groups, contexts, managed, seriesByKpi, useCases);
    return collectKpiAttention(assembled);
  } catch (e) {
    silentCatch('findings/sweepInputs:collectProjectKpiAttention')(e);
    return undefined;
  }
}
