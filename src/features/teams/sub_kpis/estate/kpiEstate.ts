// The ESTATE — one reading of the portfolio that all three overview surfaces
// share (contest `kpi-descent`, 2026-09-21; the winning entry swept Map,
// Ledger and River on the strength of using ONE grammar at every altitude).
//
// Two things it adds to `kpiOverviewModel`, both of them about honesty:
//
//  1. Every tally carries its own ABSENCE. `unmeasured` is a quantity here,
//     not a blank, and `stale` says a reading exists but has outlived the
//     cadence the KPI promised itself. A surface that draws a denominator can
//     only do it if the denominator is computed.
//  2. `attention` is the one ordering principle. A place is ranked by what a
//     human could actually do there today, not by size and not by band, so
//     the same sort works for a project, a group and a single KPI.
//
// Pure: no React, no store, no i18n. The sentences live in `kpiNextMove`.
import type { DevKpi } from '@/lib/bindings/DevKpi';

import { kpiTrack } from '../kpiMath';
import type { KpiBand, KpiGroupRollup, KpiProjectRollup } from '../kpiOverviewModel';
import { bandOf } from '../kpiOverviewModel';

const DAY_MS = 86_400_000;

/** How long a reading stays fresh, by the cadence the KPI declares. Past this
 *  the KPI is `stale`: it has a number, and the number is older than the
 *  promise attached to it. `manual` gets the loosest window because nobody
 *  promised a rhythm for it. */
export const FRESH_DAYS: Readonly<Record<string, number>> = {
  daily: 2,
  weekly: 9,
  biweekly: 17,
  monthly: 45,
  quarterly: 120,
  manual: 30,
};

const DEFAULT_FRESH_DAYS = 30;

export function freshDays(cadence: string | null | undefined): number {
  return FRESH_DAYS[cadence ?? 'manual'] ?? DEFAULT_FRESH_DAYS;
}

/** Epoch ms of a KPI's newest reading, or null when it has never been read. */
export function lastReadAt(kpi: DevKpi): number | null {
  if (!kpi.last_measured_at) return null;
  const ms = new Date(kpi.last_measured_at.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days since the newest reading; null when never read. */
export function ageDays(kpi: DevKpi, now: number): number | null {
  const at = lastReadAt(kpi);
  return at == null ? null : Math.max(0, (now - at) / DAY_MS);
}

/** A KPI that HAS been read, longer ago than its own cadence allows. An
 *  unmeasured KPI is never stale — it is dark, which is a different debt. */
export function isStale(kpi: DevKpi, now: number): boolean {
  if (kpiTrack(kpi) === 'unmeasured') return false;
  const age = ageDays(kpi, now);
  return age != null && age > freshDays(kpi.cadence);
}

/** What this KPI is missing before it can carry a verdict. `null` when it
 *  already has one. Ordered by what a person would supply first. */
export type VerdictGap = 'reading' | 'target' | 'baseline' | 'target-date' | null;

export function verdictGap(kpi: DevKpi): VerdictGap {
  const track = kpiTrack(kpi);
  if (track === 'unmeasured') return 'reading';
  if (track !== 'unpaced') return null;
  if (kpi.target_value == null) return 'target';
  if (kpi.baseline_value == null) return 'baseline';
  return 'target-date';
}

/** What a human could do here today, weighted by how much it matters. An
 *  off-track KPI outranks eight dark ones on purpose: a wrong number is worth
 *  more attention than a missing one, and a missing one is still worth some. */
export const ATTENTION_WEIGHT = { offTrack: 8, stale: 2, unpaced: 1.5, unmeasured: 1 } as const;

export function kpiAttention(kpi: DevKpi, now: number): number {
  const track = kpiTrack(kpi);
  let score = 0;
  if (track === 'off-track') score += ATTENTION_WEIGHT.offTrack;
  if (track === 'unpaced') score += ATTENTION_WEIGHT.unpaced;
  if (track === 'unmeasured') score += ATTENTION_WEIGHT.unmeasured;
  if (isStale(kpi, now)) score += ATTENTION_WEIGHT.stale;
  return score;
}

export interface KpiTally {
  total: number;
  measured: number;
  unmeasured: number;
  met: number;
  onTrack: number;
  offTrack: number;
  /** Measured, but no verdict is computable (no target, baseline or date). */
  unpaced: number;
  /** Measured, and the reading has outlived its cadence. */
  stale: number;
  /** met + onTrack + offTrack — the denominator the band divides by. */
  verdicts: number;
  /** measured / total, 0..1. Travels everywhere the band travels. */
  coverage: number;
  /** offTrack / verdicts, or null with no verdict at all. */
  offTrackShare: number | null;
  band: KpiBand;
  attention: number;
  /** Newest reading anywhere in this scope, epoch ms; null when never read. */
  lastReadAt: number | null;
}

export const EMPTY_TALLY: Readonly<KpiTally> = {
  total: 0, measured: 0, unmeasured: 0, met: 0, onTrack: 0, offTrack: 0, unpaced: 0,
  stale: 0, verdicts: 0, coverage: 0, offTrackShare: null, band: 'unmeasured', attention: 0, lastReadAt: null,
};

/** One tally over a set of KPIs. The single place every count on every
 *  surface comes from, so two surfaces can never disagree about the estate. */
export function tallyKpis(kpis: DevKpi[], now: number): KpiTally {
  const t: KpiTally = { ...EMPTY_TALLY };
  for (const kpi of kpis) {
    t.total += 1;
    const track = kpiTrack(kpi);
    if (track === 'unmeasured') {
      t.unmeasured += 1;
    } else {
      t.measured += 1;
      if (track === 'met') t.met += 1;
      else if (track === 'on-track') t.onTrack += 1;
      else if (track === 'off-track') t.offTrack += 1;
      else t.unpaced += 1;
      if (isStale(kpi, now)) t.stale += 1;
    }
    const at = lastReadAt(kpi);
    if (at != null && (t.lastReadAt == null || at > t.lastReadAt)) t.lastReadAt = at;
  }
  t.verdicts = t.met + t.onTrack + t.offTrack;
  t.coverage = t.total === 0 ? 0 : t.measured / t.total;
  t.offTrackShare = t.verdicts === 0 ? null : t.offTrack / t.verdicts;
  t.band = bandOf(t);
  t.attention =
    t.offTrack * ATTENTION_WEIGHT.offTrack +
    t.stale * ATTENTION_WEIGHT.stale +
    t.unpaced * ATTENTION_WEIGHT.unpaced +
    t.unmeasured * ATTENTION_WEIGHT.unmeasured;
  return t;
}

export interface EstateGroup extends KpiGroupRollup {
  tally: KpiTally;
}

export interface EstateProject extends Omit<KpiProjectRollup, 'groups'> {
  groups: EstateGroup[];
  tally: KpiTally;
  /** Every KPI in the project, group order then attention order. */
  kpis: DevKpi[];
}

export interface Estate {
  projects: EstateProject[];
  /** Every active KPI in scope. */
  kpis: DevKpi[];
  tally: KpiTally;
  /** Context groups that hold at least one KPI — the cells a map can draw. */
  groupCount: number;
  now: number;
}

/** KPIs worst-first inside a place: attention, then stale, then name. */
export function sortKpisByAttention(kpis: DevKpi[], now: number): DevKpi[] {
  return [...kpis].sort(
    (a, b) =>
      kpiAttention(b, now) - kpiAttention(a, now) ||
      Number(isStale(b, now)) - Number(isStale(a, now)) ||
      a.name.localeCompare(b.name),
  );
}

/** Places worst-first: attention, then the larger claim, then name. */
export function sortByAttention<T extends { tally: KpiTally; label: string }>(places: T[]): T[] {
  return [...places].sort(
    (a, b) => b.tally.attention - a.tally.attention || b.tally.total - a.tally.total || a.label.localeCompare(b.label),
  );
}

/**
 * The estate, built over the rollup every variant already receives. Nothing is
 * re-fetched and nothing is dropped: a project with no readings keeps its
 * groups and its counts, because absence is what these surfaces are for.
 */
export function buildEstate(overview: KpiProjectRollup[], now = Date.now()): Estate {
  const projects: EstateProject[] = overview.map((p) => {
    const groups = sortByAttention(
      p.groups.map((g) => ({ ...g, kpis: sortKpisByAttention(g.kpis, now), tally: tallyKpis(g.kpis, now) })),
    );
    return { ...p, groups, kpis: groups.flatMap((g) => g.kpis), tally: tallyKpis(p.groups.flatMap((g) => g.kpis), now) };
  });
  const ranked = sortByAttention(projects);
  const kpis = ranked.flatMap((p) => p.kpis);
  return {
    projects: ranked,
    kpis,
    tally: tallyKpis(kpis, now),
    groupCount: ranked.reduce((n, p) => n + p.groups.length, 0),
    now,
  };
}

/** The project a variant has descended into, or null at portfolio altitude. */
export function findProject(estate: Estate, projectId: string | null): EstateProject | null {
  return projectId == null ? null : (estate.projects.find((p) => p.projectId === projectId) ?? null);
}
