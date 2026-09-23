import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { NOTE_LIFECYCLE_BRAINSTORM, NOTE_LIFECYCLE_PLAN, noteLifecycleFor } from '../../../noteStatusMeta';

export interface Journey {
  steps: readonly NoteStatus[];
  /** Index of the goal's current step, or -1 when it cannot be placed. */
  at: number;
}

/**
 * The rail this goal is actually travelling, and where along it the goal is.
 *
 * Chosen by the STATUS first and only then by the milestone: a goal whose two
 * disagree is not supposed to exist, but when one does the timeline should
 * still say where it is rather than drawing every step as unreached.
 *
 * Shared by all three row designs so they can differ in how they DRAW the
 * journey and never in what it says.
 */
export function journeyOf(note: Pick<DevNote, 'status' | 'milestoneId'>): Journey {
  const byStatus = [NOTE_LIFECYCLE_PLAN, NOTE_LIFECYCLE_BRAINSTORM].find((l) => l.includes(note.status));
  const steps = byStatus ?? noteLifecycleFor(note.milestoneId);
  return { steps, at: steps.indexOf(note.status) };
}

/** 0..1 of the sub-goals done, or null when the milestone declares none. */
export function goalFraction(total: number | undefined, done: number | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.min(1, Math.max(0, (done ?? 0) / total));
}
