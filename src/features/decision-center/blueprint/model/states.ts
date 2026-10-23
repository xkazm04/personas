// The decision machine, as ONE table. Every move the sheet can ask for, what it needs (`from`), where the store
// takes the item (`to`) and through which door; and every status an item can show, with its tone and the moves
// it offers. The drawing never decides whether a transition is allowed: `from` only says which keys and buttons to
// OFFER. The store's answer (`decided[]` / `skipped[]` with reasons) is what the dock console prints. A triage key
// (WP4b) is never withheld on `from`: it sends, and the store's `skipped[]` says why nothing moved.
//
// Statuses are `wire.ts ProposalStatus` verbatim (ten of them). `in-release` and `note-required` are store REASONS
// on a skipped row, not statuses; a release's items show `release_id` instead. The old `cut_off` of the brief is
// not in the wire, so it is not modelled (evidence: src/lib/lensScan/wire.ts).
import type { ProposalStatus } from '@/lib/lensScan/wire';

export type MoveName = 'approve' | 'decline' | 'build' | 'accept' | 'rework' | 'descope' | 'reopen';
export type Door = 'decide' | 'start' | 'triage';
/** Whether the move asks for a reason: never, always (a dialog), or when the item is `failed` (accepting a failed build). */
export type NoteRule = 'none' | 'asked' | 'when-failed';

export interface Move {
  door: Door;
  /** The argument the door takes: `decide` approve|decline, `triage` accept|rework|descope|reopen, `start` execute. */
  arg: 'approve' | 'decline' | 'execute' | 'accept' | 'rework' | 'descope' | 'reopen';
  from: readonly ProposalStatus[];
  /** The status the store moves the item to; `triaged_from` = the status it had before its triage (the undo). */
  to: ProposalStatus | 'triaged_from';
  note: NoteRule;
}

export const MOVES: Readonly<Record<MoveName, Move>> = {
  approve: { door: 'decide', arg: 'approve', from: ['proposed'], to: 'approved', note: 'none' },
  decline: { door: 'decide', arg: 'decline', from: ['proposed'], to: 'declined', note: 'asked' },
  build: { door: 'start', arg: 'execute', from: ['approved'], to: 'executing', note: 'none' },
  accept: { door: 'triage', arg: 'accept', from: ['done', 'failed'], to: 'accepted', note: 'when-failed' },
  rework: { door: 'triage', arg: 'rework', from: ['done', 'failed', 'accepted'], to: 'rework', note: 'asked' },
  descope: { door: 'triage', arg: 'descope', from: ['done', 'failed', 'accepted', 'rework', 'proposed', 'approved'], to: 'descoped', note: 'asked' },
  reopen: { door: 'triage', arg: 'reopen', from: ['accepted', 'rework', 'descoped'], to: 'triaged_from', note: 'none' },
};

/** One tone per status family: the CSS colours chips and rows by it (never by a hue name). */
export type Tone = 'wait' | 'ok' | 'run' | 'no' | 'pack' | 'fail';

export interface StatusInfo {
  tone: Tone;
  /** The Build queue holds it: still the operator's to decide or to build. */
  queue: boolean;
  /** Nothing moves it any more (the store or a release owns it). */
  terminal: boolean;
  /** Built in a pack: the L4 sheet shows it in the compare panel (before and after, the commit), where it is triaged. */
  built: boolean;
}

export const STATUS: Readonly<Record<ProposalStatus, StatusInfo>> = {
  proposed: { tone: 'wait', queue: true, terminal: false, built: false },
  approved: { tone: 'ok', queue: true, terminal: false, built: false },
  declined: { tone: 'no', queue: false, terminal: true, built: false },
  executing: { tone: 'run', queue: false, terminal: false, built: false },
  done: { tone: 'pack', queue: false, terminal: false, built: true },
  failed: { tone: 'fail', queue: false, terminal: false, built: true },
  accepted: { tone: 'ok', queue: false, terminal: false, built: true },
  rework: { tone: 'wait', queue: false, terminal: false, built: true },
  descoped: { tone: 'no', queue: false, terminal: false, built: true },
  released: { tone: 'ok', queue: false, terminal: true, built: true },
};

export const STATUSES = Object.keys(STATUS) as ProposalStatus[];

/** A built item still waiting for a person's triage (store.mjs: `done` or `failed`; compare.ts awaitingTriage). */
export const awaitsTriage = (s: ProposalStatus): boolean => s === 'done' || s === 'failed';

/**
 * Why the store left a triaged item as it was (store.mjs `triage`, the `reason` of a `skipped[]` row), where the
 * status alone does not say. The dock console prints the reason verbatim and glosses it; a reason not listed here is
 * still printed verbatim (the store may grow one before this table does).
 */
export const TRIAGE_REASONS = ['note-required', 'in-release', 'no-prior-status', 'rebuilt', 'pack-closed'] as const;
export type TriageReason = (typeof TRIAGE_REASONS)[number];
export const isTriageReason = (r: string | undefined): r is TriageReason => !!r && (TRIAGE_REASONS as readonly string[]).includes(r);

/** The moves a status offers, in table order. */
export function movesFrom(status: ProposalStatus): MoveName[] {
  return (Object.keys(MOVES) as MoveName[]).filter((m) => MOVES[m].from.includes(status));
}

/** Of a set of statuses, those a move can act on (the rows to send; the store still has the last word). */
export function actable(move: MoveName, status: ProposalStatus): boolean {
  return MOVES[move].from.includes(status);
}
