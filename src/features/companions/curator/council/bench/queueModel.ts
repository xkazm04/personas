// The queue: three groups, one ordering, one headline count.
//
// The headline counts ONLY decidable rows. A `machine_pass` is not waiting
// on anybody and never appears in the number, which is the rule the shared
// `decidable()` predicate exists to keep true in three places at once.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { decidable } from '../councilRules';

export type QueueGroupKey = 'yours' | 'machine' | 'decided';

export interface QueueGroup {
  key: QueueGroupKey;
  rows: CouncilSubjectState[];
}

export interface FixtureDecision {
  decision: 'approved' | 'rejected';
  reason: string | null;
}

/**
 * The subject as the page should read it right now.
 *
 * With the fixture on there is no backend to write to, so a decision taken
 * in the page is folded in HERE and nowhere else - one place, so the queue,
 * the table and the gate cannot disagree about what just happened. With the
 * fixture off the map is always empty and this is the identity function.
 */
export function effectiveSubject(
  subject: CouncilSubjectState,
  fixtureDecisions: Record<string, FixtureDecision>,
): CouncilSubjectState {
  const decided = fixtureDecisions[subject.id];
  if (!decided) return subject;
  return {
    ...subject,
    state: decided.decision,
    rejectionReason: decided.reason,
    decidedAt: subject.decidedAt ?? new Date().toISOString(),
  };
}

const DECIDED = new Set(['approved', 'approved_drifted', 'rejected']);

/**
 * Inside "Yours to decide", the row a person should open first.
 *
 * Hard failures, then floor hits, then the thinnest coverage, then the
 * latest round. The brief's last two keys - evidence present and recurrence -
 * live inside a run's verdict payloads, which the LIST projection
 * deliberately does not carry (it would mean reading every run to draw a
 * queue). Round number stands in for recurrence, because a subject on its
 * third round is by definition one the council has raised findings against
 * before. Title is the final tiebreak so the order is stable.
 */
function compareYours(a: CouncilSubjectState, b: CouncilSubjectState): number {
  if (a.hardFailures !== b.hardFailures) return b.hardFailures - a.hardFailures;
  if (a.floorHits !== b.floorHits) return b.floorHits - a.floorHits;
  const ca = a.coverage ?? 1;
  const cb = b.coverage ?? 1;
  if (ca !== cb) return ca - cb;
  const ra = a.roundNo ?? 0;
  const rb = b.roundNo ?? 0;
  if (ra !== rb) return rb - ra;
  return a.title.localeCompare(b.title);
}

const byTitle = (a: CouncilSubjectState, b: CouncilSubjectState) => a.title.localeCompare(b.title);

export function queueGroups(subjects: CouncilSubjectState[]): QueueGroup[] {
  const yours: CouncilSubjectState[] = [];
  const machine: CouncilSubjectState[] = [];
  const done: CouncilSubjectState[] = [];
  for (const s of subjects) {
    if (decidable(s)) yours.push(s);
    else if (DECIDED.has(s.state)) done.push(s);
    else machine.push(s);
  }
  return [
    { key: 'yours', rows: yours.sort(compareYours) },
    { key: 'machine', rows: machine.sort(byTitle) },
    { key: 'decided', rows: done.sort(byTitle) },
  ];
}

/** The groups flattened in render order, which is the order the arrows walk. */
export function queueFlat(groups: QueueGroup[]): CouncilSubjectState[] {
  return groups.flatMap((g) => g.rows);
}
