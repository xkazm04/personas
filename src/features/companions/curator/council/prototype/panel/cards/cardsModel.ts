// PROTOTYPE ROUND (spark council-readout), direction B - Scorecards. The
// words this direction says (English only this round) and the two readings it
// makes of a row: the verdict its chip carries and its weakest member.
import type { Seat } from '../../../table/runModel';
import type { PanelRow, QueueFilter } from '../../protoModel';

export const S = {
  listLabel: 'Council queue',
  filterLabel: 'Which councils to list',
  advisory: '{threshold} ring: advisory, uncalibrated',
  round: 'round {round}',
  lite: 'lite round',
  clears: 'clears the bar',
  near: 'near the bar',
  under: 'under the bar',
  floorHit: 'floor hit',
  noOverall: 'no overall',
  toAddress: 'to address',
  weakest: 'weakest member',
  weakestNone: 'nobody measured',
  notMeasured: 'not measured',
  liteNote: 'Lite round only: readable, not decidable until a full council runs.',
  cardLabel: '{title}, {project}. Overall {overall}.',
};

/** What an empty list means, per filter. */
export const EMPTY: Record<QueueFilter, string> = {
  waiting: 'No council is waiting on you.',
  machine: 'No council was passed by the machine.',
  decided: 'You have not decided a council yet.',
};

/** The state a filter implies; a card in that state needs no chip saying so. */
export const IMPLIED_STATE: Record<QueueFilter, string | null> = {
  waiting: 'ready',
  machine: 'machine_pass',
  decided: null,
};

export type Verdict = 'clears' | 'near' | 'under' | 'floorHit' | 'noOverall';

const NEAR = 0.1;

export function verdictOf(row: PanelRow): Verdict {
  const s = row.subject;
  if (s.floorHits > 0 || s.hardFailures > 0 || s.state === 'fail') return 'floorHit';
  if (s.overall == null) return 'noOverall';
  const d = s.overall - row.rubric.threshold;
  if (d >= 0) return 'clears';
  return d >= -NEAR ? 'near' : 'under';
}

/** The chip's colour by meaning: only a floor is red; being under the bar is not. */
export const VERDICT_TONE: Record<Verdict, string> = {
  clears: 'sc-chip ok',
  near: 'sc-chip near',
  under: 'sc-chip under',
  floorHit: 'sc-chip hit',
  noOverall: 'sc-chip none',
};

/** The member holding the round down: a floor hit first, else the lowest measured score. */
export function weakestSeat(seats: Seat[]): Seat | null {
  const hit = seats.find((s) => s.floorHit);
  if (hit) return hit;
  let low: Seat | null = null;
  for (const s of seats) if (s.score != null && (low?.score == null || s.score < low.score)) low = s;
  return low;
}

export function cardId(subjectId: string): string {
  return `council-card-${subjectId}`;
}
