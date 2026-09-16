// Per-card cycle-time forecast for the desk. PURE.
//
// THE DESK FORECAST IS SUMMARY-BASED AND MAY DIFFER FROM THE PLAN PANE'S.
// `ShipVelocityNote` derives its line from `useProjectPlan`'s full
// `dev_milestones` read — every milestone in the project, shipped or not. The
// desk has only `notepadStore.planSummaries`: one row per LINKED NOTE. A project
// whose milestones are not all briefed by a note therefore has a smaller sample
// here, and the two medians can disagree until both read the same rows. That is
// a deliberate trade: loading the pane's data for every card would pull a
// project's whole L2 slice while the operator is browsing, which is the one
// thing the pad's cold-open budget cannot afford.
//
// Reuses `observedCycles` / `median` / `MIN_SAMPLES` rather than
// `deriveShipVelocity`, because that function answers "when does the NEXT
// milestone land?" — one forecast per project, picked by `order_index`. The desk
// needs one per card, and the summary carries no `order_index` to pick with.
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import {
  MIN_SAMPLES,
  MS_PER_DAY,
  cycleMs,
  isoDay,
  median,
  observedCycles,
} from '@/lib/milestone/shipVelocity';

export interface DeskForecast {
  /** `cut` = counted forward from the milestone's real cut stamp; `today` = it
   *  has not been cut, so the clock can only start now. Same vocabulary as
   *  `ShipForecast`, so the two surfaces phrase the caveat identically. */
  basis: 'cut' | 'today';
  /** Forecast ship day, `yyyy-mm-dd`. */
  date: string;
  /** Median observed cycle for the project, whole days. */
  medianDays: number;
  /** How many observed cycles that median rests on. */
  sampleSize: number;
}

/** Notes with no project share one bucket — they are still each other's only
 *  evidence, and mixing them into a real project's history would be worse. */
const bucketOf = (note: DevNote): string => note.projectId ?? '';

/**
 * A forecast per note id, for the notes that can have one.
 *
 * A note gets an entry only when (a) it is linked, (b) its milestone has not
 * shipped, and (c) its PROJECT has at least `MIN_SAMPLES` observed cut-to-ship
 * cycles among the notes on the desk. Below that bar there is no entry at all —
 * the caller renders nothing rather than a forecast built on one anecdote.
 */
export function deskForecasts(
  notes: readonly DevNote[],
  summaries: Readonly<Record<string, NotePlanSummary>>,
  now: Date = new Date(),
): Record<string, DeskForecast> {
  const byProject = new Map<string, NotePlanSummary[]>();
  for (const note of notes) {
    const summary = summaries[note.id];
    if (!summary) continue;
    const bucket = bucketOf(note);
    const list = byProject.get(bucket);
    if (list) list.push(summary);
    else byProject.set(bucket, [summary]);
  }

  const out: Record<string, DeskForecast> = {};
  for (const rows of byProject.values()) {
    const cycles = observedCycles(
      rows.map((s) => ({ status: s.milestoneStatus, cutAt: s.cutAt, shippedAt: s.shippedAt })),
    );
    if (cycles.length < MIN_SAMPLES) continue;
    // Rounded once, up front, so the date is exactly the displayed number of
    // days out — an off-by-one between the two reads as a bug.
    const medianDays = Math.round(median(cycles));
    for (const s of rows) {
      if (s.milestoneStatus === 'shipped') continue;
      const cut = cycleMs(s.cutAt);
      const from = cut ?? now.getTime();
      out[s.noteId] = {
        basis: cut === null ? 'today' : 'cut',
        date: isoDay(from + medianDays * MS_PER_DAY),
        medianDays,
        sampleSize: cycles.length,
      };
    }
  }
  return out;
}
