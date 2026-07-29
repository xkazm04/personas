// Cycle-time forecast for the Ship layer. PURE: given the project's
// dev_milestones rows, it answers the question the exit criteria cannot,
// "when does the next one land?", from the project's own history.
//
// `cut_at` and `shipped_at` are stamped on every lifecycle transition and were
// previously read only for a date label. Every shipped milestone that carries
// both is one observed cut-to-ship cycle, so a project's real pace is already
// in the rows.
//
// Two rules keep this honest:
//  1. MEDIAN, never mean. One milestone that sat for 90 days must not drag the
//     forecast for every well-behaved one.
//  2. Below MIN_SAMPLES observed cycles there is NO forecast, and the caller is
//     expected to say so plainly. A single data point is an anecdote.
import type { DevMilestone } from '@/lib/bindings/DevMilestone';

const MS_PER_DAY = 86_400_000;

/** Fewer observed cycles than this and we decline to guess. */
export const MIN_SAMPLES = 2;

export interface ShipForecast {
  milestoneId: string;
  milestoneName: string;
  /**
   * `cut` = counted forward from the milestone's real `cut_at`.
   * `today` = it has not been cut yet, so the clock can only start now.
   */
  basis: 'cut' | 'today';
  /** Forecast ship day, `yyyy-mm-dd`. */
  date: string;
  /** The declared target, when one exists. */
  targetDate: string | null;
  /** The forecast lands after the declared target. Worth saying, quietly. */
  late: boolean;
}

export interface ShipVelocity {
  /** Median observed cut-to-ship cycle, in whole days. */
  medianDays: number;
  /** How many shipped milestones the median rests on. */
  sampleSize: number;
  /** Null when every milestone is already shipped. */
  forecast: ShipForecast | null;
}

const parseMs = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Middle value; the average of the two middles for an even sample. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2;
}

/**
 * Observed cut-to-ship cycles, in days, one per shipped milestone that carries
 * both stamps. Rows with a `shipped_at` before their `cut_at` (clock skew or a
 * hand-edited row) are not evidence and are dropped.
 */
export function observedCycles(rows: DevMilestone[]): number[] {
  const out: number[] = [];
  for (const m of rows) {
    if (m.status !== 'shipped') continue;
    const cut = parseMs(m.cut_at);
    const shipped = parseMs(m.shipped_at);
    if (cut === null || shipped === null) continue;
    const days = (shipped - cut) / MS_PER_DAY;
    if (days < 0) continue;
    out.push(days);
  }
  return out;
}

/** The milestone a forecast is about: the active cut, else the first planned. */
export function nextUnshipped(rows: DevMilestone[]): DevMilestone | null {
  const ordered = [...rows].sort((a, b) => a.order_index - b.order_index);
  return ordered.find((m) => m.status === 'active')
    ?? ordered.find((m) => m.status !== 'shipped')
    ?? null;
}

/**
 * The project's cycle time and the next milestone's forecast date.
 * Returns null when the evidence bar is not met (see MIN_SAMPLES) so callers
 * cannot accidentally render a forecast built on one data point.
 */
export function deriveShipVelocity(rows: DevMilestone[], now: Date = new Date()): ShipVelocity | null {
  const cycles = observedCycles(rows);
  if (cycles.length < MIN_SAMPLES) return null;

  // Rounded once, up front, so the forecast date is exactly the displayed
  // number of days out. An off-by-one between the two reads as a bug.
  const medianDays = Math.round(median(cycles));
  const target = nextUnshipped(rows);
  let forecast: ShipForecast | null = null;

  if (target) {
    const cut = parseMs(target.cut_at);
    const basis: ShipForecast['basis'] = cut === null ? 'today' : 'cut';
    const from = cut ?? now.getTime();
    const date = isoDay(from + medianDays * MS_PER_DAY);
    forecast = {
      milestoneId: target.id,
      milestoneName: target.name,
      basis,
      date,
      targetDate: target.target_date,
      // Both sides are yyyy-mm-dd, so a lexicographic compare is a date compare.
      late: Boolean(target.target_date) && date > (target.target_date as string),
    };
  }

  return { medianDays, sampleSize: cycles.length, forecast };
}
