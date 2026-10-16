import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';
import type { Tone } from '../grid/prototype/entry-e/tone';

/* ----------------------------------------------------------------------------
 * RUN OUTCOME - what a run band says first (WP12: outcome first, detail folded).
 *
 * The rollup is the run's state from its steps: a failed step wins, then a
 * step held for the operator, then one in flight, then all settled. The
 * outcome line is what happened, in the order a reader needs it: the step
 * that waits on the operator (its title), else the newest settled step's
 * output, else nothing (the band then leads with the goal). Pure.
 * -------------------------------------------------------------------------- */

export type RunState = 'failed' | 'waiting' | 'running' | 'done' | 'pending';

export function runState(steps: readonly TeamAssignmentStep[]): RunState {
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.some((s) => s.status === 'awaiting_review')) return 'waiting';
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (steps.length > 0 && steps.every((s) => s.status === 'done' || s.status === 'skipped')) return 'done';
  return 'pending';
}

/** One plain line from a step's markdown output: the first non-empty line, marks stripped. */
export function plainLine(text: string | null | undefined): string | null {
  if (!text) return null;
  const line = text.split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  return line.replace(/^#+\s*|^[-*]\s+/, '').replace(/[*_`]/g, '').trim() || null;
}

export function runOutcome(steps: readonly TeamAssignmentStep[]): string | null {
  const held = steps.find((s) => s.status === 'awaiting_review' || s.status === 'failed');
  if (held) return held.status === 'failed' ? plainLine(held.errorMessage) ?? held.title : held.title;
  const settled = [...steps].reverse().find((s) => s.status === 'done' && s.outputSummary);
  return plainLine(settled?.outputSummary);
}

/** The band's window and lamp: lit while it works or needs the operator; a settled run is calm glass. */
export const RUN_LOOK: Record<RunState, { win: string; tone: Tone; lit: boolean }> = {
  failed: { win: 'ae-t-err is-lit', tone: 'err', lit: true },
  waiting: { win: 'ae-t-warn is-lit', tone: 'warn', lit: true },
  running: { win: 'ae-t-info is-lit', tone: 'info', lit: true },
  done: { win: 'ae-t-ok', tone: 'ok', lit: false },
  pending: { win: 'ae-t-info', tone: 'info', lit: false },
};
