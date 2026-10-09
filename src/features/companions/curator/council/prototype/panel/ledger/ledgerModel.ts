// PROTOTYPE ROUND (spark council-readout), direction A - Ledger strip.
// The words and the one judgement this direction makes about a row: how far
// its overall sits from the bar. English only this round (see protoStrings).
import type { PanelRow, QueueFilter } from '../../protoModel';

export const S = {
  listLabel: 'Council queue',
  filterLabel: 'Which councils to list',
  /** The uncalibrated instrument, said once for the whole column. */
  advisory: '{threshold} bar: advisory, uncalibrated',
  round: 'round {round}',
  lite: 'lite',
  toAddress: '{count} to address',
  floorHit: 'floor hit',
  floorHits: '{count} floor hits',
  hardFailures: '{count} hard failures',
  under: '{margin} under',
  over: '{margin} over',
  noOverall: 'no overall',
  notMeasured: 'not measured',
  measured: '{percent} measured',
  liteNote: 'Lite round only. Readable, not decidable until a full council runs.',
  legendMembers: 'members',
  legendFloor: 'floor',
  legendCoverage: 'coverage',
  rowLabel: '{title}, {project}. Overall {overall} against the {threshold} bar.',
};

/** What an empty list means, per filter. */
export const EMPTY: Record<QueueFilter, string> = {
  waiting: 'No council is waiting on you.',
  machine: 'No council was passed by the machine.',
  decided: 'You have not decided a council yet.',
};

/** The state a filter implies; a row in that state needs no chip saying so. */
export const IMPLIED_STATE: Record<QueueFilter, string | null> = {
  waiting: 'ready',
  machine: 'machine_pass',
  decided: null,
};

/**
 * How the overall reads against the bar. Never red: being under an
 * uncalibrated bar is not a failure, and a floor hit is said by its own pill
 * and its red segment rather than by the figure.
 */
export type Distance = 'clears' | 'near' | 'far' | 'none';

/** Within this of the bar a miss is a near miss. */
const NEAR = 0.1;

export function distanceOf(row: PanelRow): Distance {
  const s = row.subject;
  if (s.overall == null) return 'none';
  const d = s.overall - row.rubric.threshold;
  if (d >= 0) return 'clears';
  return d >= -NEAR ? 'near' : 'far';
}

export const DISTANCE_TEXT: Record<Distance, string> = {
  clears: 'text-status-success',
  near: 'text-status-warning',
  far: 'text-foreground',
  none: 'text-muted',
};

export function optionId(subjectId: string): string {
  return `council-ledger-${subjectId}`;
}
