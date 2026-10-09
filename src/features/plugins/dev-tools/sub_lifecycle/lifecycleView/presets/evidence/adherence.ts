/**
 * ADHERENCE OVER TIME: a step's done rate per calendar week, or per ten
 * changes when the record spans fewer than {@link MIN_WEEKS} weeks. Pure: no
 * React, no i18n, no IO; time zones are injected (`offsetOf`) so the unit test
 * pins them.
 *
 * Weeks start on Monday at local midnight. Weeks with no change between the
 * oldest change and the newest week stay in the series as empty slots, so the
 * time axis is honest about gaps; only the newest {@link MAX_WEEKS} are kept.
 * Change buckets are counted back from the newest change, so the newest bucket
 * is the full one and the oldest may be short.
 */
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

/** Fewer weeks than this between the oldest change and the newest week: bucket by changes instead. */
export const MIN_WEEKS = 4;
/** The most weeks the figure draws. */
export const MAX_WEEKS = 26;
/** Changes per bucket in the short-span mode. */
export const CHANGES_PER_BUCKET = 10;

const DAY_MS = 86_400_000;

/** Minutes to add to local time to reach UTC, as `Date#getTimezoneOffset` returns it. */
export type OffsetOf = (ms: number) => number;
export const hostOffset: OffsetOf = (ms) => new Date(ms).getTimezoneOffset();

export interface AdherenceInput {
  outcome: LifecycleOutcome;
  occurredAt: string;
}

export interface AdherenceBucket {
  /** Weeks: the local day number (days since 1970-01-01) of its Monday. Changes: its index, oldest = 0. */
  key: number;
  /** Local day numbers of its first and last day (weeks) or of its oldest and newest change (changes). */
  fromDay: number;
  toDay: number;
  done: number;
  skipped: number;
  failed: number;
  unknown: number;
  /** Changes the rate counts (unknown is not one). */
  n: number;
  /** 0-100, null when `n` is 0. */
  ratePct: number | null;
  /** At least `minSamples` changes: a rate to judge, not a hint. */
  judged: boolean;
}

export interface Adherence {
  mode: 'week' | 'changes';
  buckets: AdherenceBucket[];
  /** Weeks dropped off the old end to keep {@link MAX_WEEKS}. */
  clipped: number;
}

/**
 * The done rate of a set of outcomes. It MUST match health.rs `evidence_step`
 * (counted = done + skipped + failed; unknown is not counted), which judges the
 * same rate for the verdict: adherence.test.ts reads health.rs and fails when
 * that formula changes.
 */
export function doneRate(c: Pick<AdherenceBucket, 'done' | 'skipped' | 'failed'>): { n: number; ratePct: number | null } {
  const n = c.done + c.skipped + c.failed;
  return { n, ratePct: n > 0 ? (c.done * 100) / n : null };
}

/** The local day number of an instant. */
export function localDay(ms: number, offsetOf: OffsetOf = hostOffset): number {
  return Math.floor((ms - offsetOf(ms) * 60_000) / DAY_MS);
}

/** The Monday of a local day number (1970-01-01 was a Thursday). */
export function mondayOf(day: number): number {
  return day - (((day + 3) % 7) + 7) % 7;
}

/** A local day number as a Date whose UTC fields are that day: format it with `timeZone: 'UTC'`. */
export function dayAsUtcDate(day: number): Date {
  return new Date(day * DAY_MS);
}

function empty(key: number, fromDay: number, toDay: number): AdherenceBucket {
  return { key, fromDay, toDay, done: 0, skipped: 0, failed: 0, unknown: 0, n: 0, ratePct: null, judged: false };
}

function seal(b: AdherenceBucket, minSamples: number): AdherenceBucket {
  const { n, ratePct } = doneRate(b);
  return { ...b, n, ratePct, judged: n >= minSamples };
}

interface Dated { outcome: LifecycleOutcome; day: number }

function byWeek(dated: Dated[], minSamples: number, nowDay: number | null): Adherence {
  const first = mondayOf(Math.min(...dated.map((d) => d.day)));
  const last = mondayOf(Math.max(nowDay ?? -Infinity, ...dated.map((d) => d.day)));
  const weeks = new Map<number, AdherenceBucket>();
  for (let m = first; m <= last; m += 7) weeks.set(m, empty(m, m, m + 6));
  for (const d of dated) weeks.get(mondayOf(d.day))![d.outcome] += 1;
  const all = [...weeks.values()].map((b) => seal(b, minSamples));
  const clipped = Math.max(0, all.length - MAX_WEEKS);
  return { mode: 'week', buckets: all.slice(clipped), clipped };
}

function byChanges(dated: Dated[], minSamples: number): Adherence {
  // Newest first in; counted from the newest back, then drawn oldest to newest.
  const counted = dated.filter((d) => d.outcome !== 'unknown');
  const buckets: AdherenceBucket[] = [];
  for (let i = 0; i < counted.length; i += CHANGES_PER_BUCKET) {
    const slice = counted.slice(i, i + CHANGES_PER_BUCKET);
    const b = empty(0, slice[slice.length - 1]!.day, slice[0]!.day);
    for (const d of slice) b[d.outcome] += 1;
    buckets.unshift(seal(b, minSamples));
  }
  return { mode: 'changes', buckets: buckets.map((b, key) => ({ ...b, key })), clipped: 0 };
}

/**
 * The series for one step. `inputs` newest first; `now` (ms) extends the weeks
 * to the current one, so a quiet stretch shows as empty weeks at the end.
 */
export function adherence(
  inputs: readonly AdherenceInput[],
  opts: { minSamples: number; now?: number; offsetOf?: OffsetOf },
): Adherence {
  const offsetOf = opts.offsetOf ?? hostOffset;
  const dated: Dated[] = [];
  for (const i of inputs) {
    const ms = Date.parse(i.occurredAt);
    if (!Number.isNaN(ms)) dated.push({ outcome: i.outcome, day: localDay(ms, offsetOf) });
  }
  if (dated.length === 0) return { mode: 'week', buckets: [], clipped: 0 };
  const nowDay = opts.now != null ? localDay(opts.now, offsetOf) : null;
  const oldest = Math.min(...dated.map((d) => d.day));
  const newest = Math.max(nowDay ?? -Infinity, ...dated.map((d) => d.day));
  const spanWeeks = (mondayOf(newest) - mondayOf(oldest)) / 7 + 1;
  return spanWeeks < MIN_WEEKS ? byChanges(dated, opts.minSamples) : byWeek(dated, opts.minSamples, nowDay);
}
