// THE ALMANAC - the estate read as a SCHEDULE OF READINGS, forwards.
//
// `cadence` is a promise ("weekly") and `last_measured_at` is when the promise
// was last kept. Together they give every KPI a DUE DATE, and nothing in this
// module computes one: `isStale` reduces the same two fields to a boolean, so
// the estate can say "stale" but never "three weeks late", and never "due on
// Thursday". River reads the same material BACKWARDS - twelve closed weeks of
// flow - which answers whether the estate measured, not what it owes next.
//
// Measured on this machine 2026-10-06: 861 of 1,044 active KPIs are on the
// `manual` cadence, which promises no rhythm at all - they are due NEVER, and
// 735 of those have also never been read. Of the 183 that did promise a rhythm
// (179 weekly, 4 daily), every single one is past due, 165 of them because no
// first reading was ever taken. So the honest picture is a mass piled up
// behind today and a right margin at infinity, and this derivation exists to
// make both of those quantities rather than one grey "unmeasured" bucket.
//
// Pure: no React, no store, no i18n.
import type { DevKpi } from '@/lib/bindings/DevKpi';

import { kpiTrack } from '../../kpiMath';
import { freshDays, lastReadAt, type KpiTally } from '../../estate/kpiEstate';

const DAY_MS = 86_400_000;

/** Cadences that promise a rhythm. Anything else (today: `manual`) promises
 *  none, and a KPI with no rhythm is due NEVER - which is a position on the
 *  axis, not an absence from it. */
const PROMISED = new Set(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly']);

/** Within this many days of its due date a reading reads as imminent rather
 *  than as scheduled. One day on a daily cadence, two on a weekly: a third of
 *  the freshness window, so the warning scales with the promise. */
const IMMINENT_FRACTION = 1 / 3;

export type DueState = 'overdue' | 'imminent' | 'scheduled' | 'never';

export interface Due {
  kpi: DevKpi;
  state: DueState;
  /** When the next reading is owed, epoch ms. Null = due never. */
  dueAt: number | null;
  /** Whole days until due; NEGATIVE means that many days late. Null = never. */
  daysLeft: number | null;
  /** No reading has ever been taken, so the clock runs from `created_at`. */
  neverRead: boolean;
}

/**
 * One KPI's position on the axis. A KPI that promised a rhythm and was never
 * read is paced from `created_at`, not excused: the promise started when the
 * KPI did.
 */
export function dueOf(kpi: DevKpi, now: number): Due {
  const neverRead = kpiTrack(kpi) === 'unmeasured' || lastReadAt(kpi) == null;
  if (!PROMISED.has(kpi.cadence ?? 'manual')) {
    return { kpi, state: 'never', dueAt: null, daysLeft: null, neverRead };
  }
  const window = freshDays(kpi.cadence);
  const from = lastReadAt(kpi) ?? parseStamp(kpi.created_at) ?? now;
  const dueAt = from + window * DAY_MS;
  const daysLeft = Math.round((dueAt - now) / DAY_MS);
  const state: DueState = daysLeft < 0 ? 'overdue' : daysLeft <= window * IMMINENT_FRACTION ? 'imminent' : 'scheduled';
  return { kpi, state, dueAt, daysLeft, neverRead };
}

function parseStamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ms = new Date(raw.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** One place's mark on the axis for one state. */
export interface AlmanacMark {
  state: DueState;
  count: number;
  /** Of which never produced a reading. */
  neverRead: number;
  /** The extreme of this mark: days LATE for overdue (positive), days AHEAD
   *  otherwise. Null for `never`, which has no distance. */
  days: number | null;
}

export interface AlmanacRow {
  /** `AssayPlace`-shaped: a project at the portfolio, a group inside one. */
  id: string;
  label: string;
  total: number;
  marks: Record<DueState, AlmanacMark>;
  /** Days late at the deepest KPI here, 0 when nothing is overdue. Sorts. */
  depth: number;
}

export interface Almanac {
  rows: AlmanacRow[];
  /** Days late at the deepest KPI anywhere - the left edge of the axis. */
  deepest: number;
  /** Days ahead at the farthest scheduled KPI - the right edge. */
  farthest: number;
  /** The largest population in any one mark, for the height scale. */
  tallest: number;
  totals: Record<DueState, AlmanacMark>;
  total: number;
}

const STATES: DueState[] = ['overdue', 'imminent', 'scheduled', 'never'];

function emptyMarks(): Record<DueState, AlmanacMark> {
  return {
    overdue: { state: 'overdue', count: 0, neverRead: 0, days: null },
    imminent: { state: 'imminent', count: 0, neverRead: 0, days: null },
    scheduled: { state: 'scheduled', count: 0, neverRead: 0, days: null },
    never: { state: 'never', count: 0, neverRead: 0, days: null },
  };
}

function record(into: Record<DueState, AlmanacMark>, due: Due): void {
  const mark = into[due.state];
  mark.count += 1;
  if (due.neverRead) mark.neverRead += 1;
  if (due.daysLeft != null) {
    const distance = due.state === 'overdue' ? -due.daysLeft : due.daysLeft;
    if (mark.days == null || distance > mark.days) mark.days = distance;
  }
}

/** The almanac over places whose KPIs the estate already grouped. */
export function buildAlmanac(places: { id: string; label: string; kpis: DevKpi[] }[], now: number): Almanac {
  const totals = emptyMarks();
  const rows: AlmanacRow[] = places.map((place) => {
    const marks = emptyMarks();
    for (const kpi of place.kpis) {
      const due = dueOf(kpi, now);
      record(marks, due);
      record(totals, due);
    }
    return {
      id: place.id,
      label: place.label,
      total: place.kpis.length,
      marks,
      depth: marks.overdue.days ?? 0,
    };
  });
  // Deepest debt first, then the larger claim - the same ordering principle
  // `sortByAttention` uses, applied to lateness instead of to attention.
  rows.sort((a, b) => b.depth - a.depth || b.total - a.total || a.label.localeCompare(b.label));
  return {
    rows,
    deepest: Math.max(0, ...rows.map((r) => r.depth)),
    farthest: Math.max(0, ...rows.flatMap((r) => [r.marks.imminent.days ?? 0, r.marks.scheduled.days ?? 0])),
    tallest: Math.max(1, ...rows.flatMap((r) => STATES.map((s) => r.marks[s].count))),
    totals,
    total: rows.reduce((n, r) => n + r.total, 0),
  };
}

/** The one sentence the surface opens with, as numbers: how much of the estate
 *  promised a rhythm at all. A tally is passed in rather than recomputed so
 *  the almanac can never disagree with the headline above it. */
export function promisedShare(almanac: Almanac, tally: KpiTally): { promised: number; of: number } {
  return { promised: almanac.total - almanac.totals.never.count, of: tally.total };
}
