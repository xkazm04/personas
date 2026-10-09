// The rules the whole Council surface shares. A rule lives here exactly once,
// because the gate, the headline count and the queue grouping must never
// disagree about what a person is allowed to decide.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import type { CouncilMark } from './galaxy/engine/types';

type GateSubject = Pick<CouncilSubjectState, 'state' | 'tier' | 'kind' | 'mode'>;

/**
 * Whether a council WAITS ON the person: a `ready` subject that is a MAJOR
 * feature or an architecture redesign. This is the "Waiting on you" list.
 * It includes a subject whose only round is LITE: that one waits on the
 * person too - to run a full council - and the page offers exactly that.
 * `machine_pass` is not waiting on anybody.
 */
export function awaitsYou(subject: Omit<GateSubject, 'mode'>): boolean {
  return subject.state === 'ready' && (subject.tier === 'major' || subject.kind === 'architecture');
}

/**
 * THE gate rule: a subject a person may DECIDE now - it waits on them AND
 * its state comes from a full round. A lite pass is the council's feedback,
 * never its verdict, and the decide door refuses it
 * (`a_lite_run_is_never_decided_and_a_full_ready_still_is`), so a gate that
 * opened on one would offer an Approve the backend turns down.
 */
export function decidable(subject: GateSubject): boolean {
  return awaitsYou(subject) && subject.mode !== 'lite';
}

/** How many councils are waiting on the person right now. */
export function decidableCount(subjects: CouncilSubjectState[]): number {
  return subjects.reduce((n, s) => n + (decidable(s) ? 1 : 0), 0);
}

export interface PressureRamp {
  /** What the ramp is a fraction OF. Never implied, always printed. */
  denominator: number;
  approved: number;
  pending: number;
  rejected: number;
  /**
   * Subjects the council has never reached. Its own neutral treatment — it is
   * NOT a low score and it is not zero progress, it is absence of measurement,
   * and it is ~97% of the corpus by design.
   */
  notMeasured: number;
}

/**
 * The pressure a cluster is under, as fractions of its own subject count.
 *
 * `rejected` gets its own stop rather than being folded into "decided": a
 * rejection is a different fact from an approval and the rim must say so.
 * The four fractions sum to 1 whenever the denominator is positive.
 */
export function pressureRamp(counts: Record<CouncilMark, number>, denominator: number): PressureRamp {
  if (denominator <= 0) {
    return { denominator: 0, approved: 0, pending: 0, rejected: 0, notMeasured: 0 };
  }
  const approved = counts.approved / denominator;
  const pending = counts.pending / denominator;
  const rejected = counts.rejected / denominator;
  return {
    denominator,
    approved,
    pending,
    rejected,
    notMeasured: Math.max(0, 1 - approved - pending - rejected),
  };
}
