// Pure facts the ledger prints about a contest: which seat made a variant,
// which seat made the winner, what the review can open, and the "what did
// I gain" line of a decided contest.
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import type { SeatWinRate } from '../../../stats';

/** The spec of the seat that built a variant, or null when the seat is gone. */
export function variantSeatSpec(
  detail: Pick<ContestDetail, 'seats'>,
  variant: Pick<ContestVariant, 'seatId'>,
): string | null {
  return detail.seats.find((s) => s.kind === 'participant' && s.seatId === variant.seatId)?.spec ?? null;
}

/** Phases whose variants are worth opening in the review split. */
export function isReviewable(phase: ContestPhase): boolean {
  return phase === 'review' || phase === 'shortlisted' || phase === 'decided';
}

/** Phases the autopilot is still moving. */
export function isLive(phase: ContestPhase): boolean {
  return phase === 'queued' || phase === 'running' || phase === 'collecting' || phase === 'judging';
}

/** Variants grouped by seat letter, in manifest order. */
export function variantsByLetter(variants: readonly ContestVariant[]): { letter: string; variants: ContestVariant[] }[] {
  const groups = new Map<string, ContestVariant[]>();
  for (const v of variants) {
    const list = groups.get(v.letter) ?? [];
    list.push(v);
    groups.set(v.letter, list);
  }
  return [...groups.entries()].map(([letter, list]) => ({ letter, variants: list }));
}

/** One decided contest's gain: the winner, the seat that made it, the round,
 *  and that seat's win-rate interval across every decided contest. */
export interface LedgerGain {
  summary: ContestSummary;
  key: string;
  winner: string;
  seatSpec: string | null;
  /** 1 for a first-round contest. */
  round: number;
  rate: SeatWinRate | null;
}

export function ledgerGains(summaries: readonly ContestSummary[], rates: readonly SeatWinRate[]): LedgerGain[] {
  const bySpec = new Map(rates.map((r) => [r.spec, r]));
  return summaries
    .filter((s) => s.phase === 'decided' && s.winner)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.contestId.localeCompare(b.contestId))
    .map((s) => ({
      summary: s,
      key: `${s.projectId}/${s.contestId}`,
      winner: s.winner!,
      seatSpec: s.winnerSeatSpec,
      round: s.round ?? 1,
      rate: s.winnerSeatSpec ? (bySpec.get(s.winnerSeatSpec) ?? null) : null,
    }));
}
