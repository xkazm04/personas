// ---------------------------------------------------------------------------
// Statistical honesty for a win-rate ranking.
//
// A board that orders seats by wins and renders a win-rate percentage PRESENTS
// AN ORDERING AS A CONCLUSION. A conclusion needs evidence, and a seat spec
// typically has entered one to three decided contests, so "80% win rate" is
// routinely 4 wins out of 5, or 1 out of 1. Nothing here changes an ordering;
// it attaches the uncertainty the order would otherwise be read without.
//
// Wilson score interval rather than the normal approximation: the normal
// interval degenerates at exactly the sample sizes such a board actually sees
// (p̂ = 0 or 1 gives a zero-width interval, which would claim CERTAINTY from
// one contest — the opposite of the point).
//
// Moved unchanged from the retired Competition leaderboard (2026-09-24).
// ---------------------------------------------------------------------------

/** Below this many decided contests a rate is a curiosity, not a measurement. */
export const MIN_RANKABLE_SAMPLE = 5;

const Z_95 = 1.959964;

export interface WinRateInterval {
  /** Lower bound of the 95% Wilson interval, 0..1. */
  low: number;
  /** Upper bound of the 95% Wilson interval, 0..1. */
  high: number;
}

/** 95% Wilson score interval for `wins` successes out of `total` trials. */
export function wilsonInterval(wins: number, total: number): WinRateInterval {
  // No trials means no information — the honest interval is the whole range.
  if (total <= 0) return { low: 0, high: 1 };
  const p = Math.min(1, Math.max(0, wins / total));
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const margin = (Z_95 / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/**
 * Is a board's headline claim — "#1 beats #2" — actually supported?
 * True only when the leader's lower bound clears the runner-up's upper bound.
 * A single row is trivially "separated": there is no comparison being made.
 */
export function isTopOrderingSeparated(stats: { wins: number; total: number }[]): boolean {
  if (stats.length < 2) return true;
  const first = wilsonInterval(stats[0]!.wins, stats[0]!.total);
  const second = wilsonInterval(stats[1]!.wins, stats[1]!.total);
  return first.low > second.high;
}

// ---------------------------------------------------------------------------
// Seat win rates across decided contests.
// ---------------------------------------------------------------------------

/** One seat spec's record across decided contests. */
export interface SeatWinRate extends WinRateInterval {
  /** The seat spec string, `engine:model@effort[#label]`. */
  spec: string;
  /** Decided contests this spec sat in. */
  entered: number;
  /** Of those, the ones its variant won. */
  wins: number;
}

/** Where the win-rate board stands: the rows, ordered, plus whether the
 *  ordering's headline ("#1 beats #2") is statistically supported. */
export interface SeatWinBoard {
  rows: SeatWinRate[];
  /** Leader's lower bound clears the runner-up's upper bound. */
  separated: boolean;
  /** Decided contests counted. */
  decided: number;
}

/**
 * Win rate per seat spec, keyed by spec across DECIDED contests: "entered" =
 * a decided contest whose `seatSpecs` include the spec, "win" = it is the
 * contest's `winnerSeatSpec`. Ordered by wins, then by the interval's lower
 * bound (the honest tiebreak: more evidence first), then by spec for a stable
 * order.
 */
export function seatWinRates(
  summaries: readonly {
    phase: string;
    seatSpecs: readonly string[];
    winnerSeatSpec: string | null;
  }[],
): SeatWinBoard {
  const tally = new Map<string, { entered: number; wins: number }>();
  let decided = 0;
  for (const s of summaries) {
    if (s.phase !== 'decided') continue;
    decided += 1;
    for (const spec of new Set(s.seatSpecs)) {
      const row = tally.get(spec) ?? { entered: 0, wins: 0 };
      row.entered += 1;
      if (s.winnerSeatSpec === spec) row.wins += 1;
      tally.set(spec, row);
    }
  }
  const rows: SeatWinRate[] = [...tally.entries()].map(([spec, { entered, wins }]) => ({
    spec,
    entered,
    wins,
    ...wilsonInterval(wins, entered),
  }));
  rows.sort((a, b) => b.wins - a.wins || b.low - a.low || a.spec.localeCompare(b.spec));
  return {
    rows,
    separated: isTopOrderingSeparated(rows.map((r) => ({ wins: r.wins, total: r.entered }))),
    decided,
  };
}
