// Cohorts — the derivation the whole concept rests on.
//
// THE MEASUREMENT THAT FORCED IT. 102 projects in dev_projects on this machine
// and 14 rows in dev_scans (2026-10-06): the great majority of the portfolio
// has never been scanned, so its passports are derived from the project row
// alone and are therefore IDENTICAL to each other. A matrix draws that fact
// 88 times. The portfolio's real cardinality is the number of distinct
// passports in it, which is a far smaller number than the number of projects,
// and nothing in the atlas had ever computed it.
//
// A cohort is an exact signature over the lens's dimensions - no bucketing, no
// rounding, no clustering heuristic - so two projects share a band only when
// every single cell agrees. That keeps the grouping a FACT about the data
// rather than a judgement about it, which is the only reason it is safe to
// draw the shape once and let it speak for its members.
import type { AppPassport } from '../../../passportModel';
import { inkOf, type AtlasInk, type AtlasRow } from '../../atlasModel';
import { ABSENT } from '../stampsheet/stampsheet.model';

export interface CohortMember {
  p: AppPassport;
  /** The index into the figure's `projects`, so the roving coordinate survives. */
  pi: number;
}

export interface Cohort {
  /** The signature itself, which is also the React key. */
  id: string;
  /** One ink per lens dimension, in lens order. */
  inks: AtlasInk[];
  members: CohortMember[];
  /** How many of the lens's dimensions carry a verdict in this shape. */
  known: number;
}

/** The portfolio's distinct shapes, largest cohort first; a tie keeps the
 *  project sort order, so the bands are stable under re-sorting. */
export function groupCohorts(projects: AppPassport[], rows: AtlasRow[]): Cohort[] {
  const by = new Map<string, Cohort>();
  projects.forEach((p, pi) => {
    const inks = rows.map((r) => inkOf(p, r));
    const id = inks.join('|');
    const band = by.get(id);
    if (band) { band.members.push({ p, pi }); return; }
    by.set(id, { id, inks, members: [{ p, pi }], known: inks.filter((i) => !ABSENT.has(i)).length });
  });
  const order = [...by.values()];
  return order.sort((a, b) =>
    b.members.length - a.members.length
    || (a.members[0]?.pi ?? 0) - (b.members[0]?.pi ?? 0));
}

/** Which band holds the roving project. -1 when the lens is empty. */
export function bandOf(cohorts: Cohort[], pi: number): number {
  return cohorts.findIndex((c) => c.members.some((m) => m.pi === pi));
}

/** How much of the portfolio the bands actually compress: the headline the
 *  concept stakes itself on, stated on the figure rather than claimed here. */
export function collapse(cohorts: Cohort[], projects: number): { shapes: number; projects: number } {
  return { shapes: cohorts.length, projects };
}
