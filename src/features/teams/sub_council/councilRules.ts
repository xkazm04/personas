// The rules the whole Council surface shares. A rule lives here exactly once,
// because the gate, the headline count and the queue grouping must never
// disagree about what a person is allowed to decide.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import type { CouncilMark } from './galaxy/engine/types';

/**
 * THE rule: only a `ready` subject that is a MAJOR feature or an architecture
 * redesign reaches a person. Everything else shows a closed gate with one
 * sentence saying why. `machine_pass` is not waiting on anybody.
 */
export function decidable(subject: Pick<CouncilSubjectState, 'state' | 'tier' | 'kind'>): boolean {
  return subject.state === 'ready' && (subject.tier === 'major' || subject.kind === 'architecture');
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
