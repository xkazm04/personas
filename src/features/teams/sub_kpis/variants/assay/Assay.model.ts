// THE ASSAY - the estate read as an INSTRUMENT BENCH rather than a scoreboard.
//
// Why this derivation exists. Measured against this machine's database on
// 2026-10-06: 1,044 active KPIs, of which 900 have never produced a number,
// 78 have a number that cannot be judged, 66 are met and ZERO are off-track.
// Every surface in this module ranks by verdict or by attention, so on the
// real estate all of them are ranking over 144 of 1,044 rows and painting the
// other 900 as an absence. The question the data actually poses is not "which
// KPI is behind" but "why does nothing here produce a number".
//
// `measure_kind` answers it and NOTHING on the dashboard reads that field
// today (grepped: it appears only in the detail modal and the describe
// helper). Split the same estate by how a reading is OBTAINED and the estate
// stops being uniformly dark:
//
//   entered by you          829 declared ->   5 read   (0.6 % yield)
//   measured from the code  184 declared -> 138 read   (75 % yield)
//   fetched from a service   30 declared ->   0 read   (0 % yield)
//   tracked from activity     1 declared ->   1 read
//
// That is the finding, and it is a finding about MECHANISM, not about any KPI.
//
// Three stages, each defined by what the estate can honestly know at it:
//   DECLARED  every active KPI in the lane.
//   OBSERVED  `current_value != null` - a number exists.
//   VERDICT   `verdictGap() === null` - the number can be judged.
// Between them two gates, and a gate is where the population is LOST. The
// loss carries the thing it is missing (`VerdictGap`), which is the same
// vocabulary `kpiNextMove` already prints, so the gate names an action.
//
// Pure: no React, no store, no i18n.
import { kpiTrack } from '../../kpiMath';
import { isStale, verdictGap, type VerdictGap } from '../../estate/kpiEstate';
import type { KpiPlace } from '../kpiPlaces';

/** A missing prerequisite, and how many KPIs in a lane are missing it. */
export interface AssayGap {
  gap: Exclude<VerdictGap, null>;
  count: number;
}

/** One place's contribution to a lane's stalled population. */
export interface AssayShare {
  /** The place's id, as `KpiPlace.id` gave it. */
  id: string;
  label: string;
  /** Stalled here: declared but not yet carrying a verdict. */
  count: number;
  /** Of which have never produced a number at all. */
  dark: number;
}

export interface AssayLane {
  /** `measure_kind`: how a reading is obtained. */
  kind: string;
  declared: number;
  /** Has a number. */
  observed: number;
  /** Has a number AND the number can be judged. */
  verdict: number;
  met: number;
  onTrack: number;
  offTrack: number;
  /** Observed, and the reading has outlived its own cadence. */
  stale: number;
  /** Lost at the first gate: declared, never read. */
  dark: number;
  /** Lost at the second gate: read, no verdict possible. */
  unjudged: number;
  /** observed / declared, 0..1 - the lane's YIELD, which is the whole point. */
  yield: number;
  /** What the lost population is missing, commonest first. */
  gaps: AssayGap[];
  /** Who owns the loss, largest first. */
  stalled: AssayShare[];
}

export interface Assay {
  /** Lanes by declared size, largest first - the widest pipe reads first. */
  lanes: AssayLane[];
  declared: number;
  observed: number;
  verdict: number;
  /** The widest lane's declared count, so every lane can be drawn to one scale. */
  widest: number;
}

const GAP_ORDER: Exclude<VerdictGap, null>[] = ['reading', 'target', 'baseline', 'target-date'];

function emptyLane(kind: string): AssayLane {
  return {
    kind, declared: 0, observed: 0, verdict: 0, met: 0, onTrack: 0, offTrack: 0,
    stale: 0, dark: 0, unjudged: 0, yield: 0, gaps: [], stalled: [],
  };
}

/**
 * The bench, built over places whose KPIs the estate already grouped. Nothing
 * is re-fetched, nothing is dropped and nothing is capped: a lane with one KPI
 * in it is still a lane, because a mechanism nobody uses is itself a reading
 * of the estate.
 */
export function buildAssay(places: KpiPlace[], now: number): Assay {
  const lanes = new Map<string, AssayLane>();
  const gaps = new Map<string, Map<string, number>>();
  const shares = new Map<string, Map<string, AssayShare>>();

  for (const place of places) {
    for (const kpi of place.kpis) {
      const kind = kpi.measure_kind || 'manual';
      let lane = lanes.get(kind);
      if (!lane) { lane = emptyLane(kind); lanes.set(kind, lane); }
      lane.declared += 1;

      const track = kpiTrack(kpi);
      const gap = verdictGap(kpi);
      if (track !== 'unmeasured') {
        lane.observed += 1;
        // Staleness belongs to the READING, not to the verdict: a number that
        // outlived its cadence is stale whether or not anything can judge it,
        // and counting it only among verdicts would hide every stale reading
        // in the unjudged population (which is where most of them are).
        if (isStale(kpi, now)) lane.stale += 1;
      }
      if (gap == null) {
        lane.verdict += 1;
        if (track === 'met') lane.met += 1;
        else if (track === 'on-track') lane.onTrack += 1;
        else if (track === 'off-track') lane.offTrack += 1;
      } else {
        if (gap === 'reading') lane.dark += 1;
        else lane.unjudged += 1;
        bump(gaps, kind, gap);
        share(shares, kind, place.id, place.label, gap === 'reading');
      }
    }
  }

  const out = [...lanes.values()].sort((a, b) => b.declared - a.declared || a.kind.localeCompare(b.kind));
  for (const lane of out) {
    lane.yield = lane.declared === 0 ? 0 : lane.observed / lane.declared;
    lane.gaps = GAP_ORDER.map((gap) => ({ gap, count: gaps.get(lane.kind)?.get(gap) ?? 0 })).filter((g) => g.count > 0);
    lane.stalled = [...(shares.get(lane.kind)?.values() ?? [])].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    );
  }
  return {
    lanes: out,
    declared: out.reduce((n, l) => n + l.declared, 0),
    observed: out.reduce((n, l) => n + l.observed, 0),
    verdict: out.reduce((n, l) => n + l.verdict, 0),
    widest: out.reduce((n, l) => Math.max(n, l.declared), 0),
  };
}

function bump(into: Map<string, Map<string, number>>, kind: string, gap: string): void {
  let inner = into.get(kind);
  if (!inner) { inner = new Map(); into.set(kind, inner); }
  inner.set(gap, (inner.get(gap) ?? 0) + 1);
}

function share(
  into: Map<string, Map<string, AssayShare>>,
  kind: string,
  id: string,
  label: string,
  dark: boolean,
): void {
  let inner = into.get(kind);
  if (!inner) { inner = new Map(); into.set(kind, inner); }
  let row = inner.get(id);
  if (!row) { row = { id, label, count: 0, dark: 0 }; inner.set(id, row); }
  row.count += 1;
  if (dark) row.dark += 1;
}
