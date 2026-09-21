// "Athena is working on this note" — as a module store keyed by note id.
//
// Lifted out of `NoteDispatchBar`, where it was component state, so that the
// desk card's presence chip, the card menu's quick-ask and the bar all read ONE
// answer. Component state could not survive the operator stepping back to the
// desk: the bar unmounted and the wait it was showing went with it, while
// Athena was still holding the note.
//
// "Asking" is a state, not an instant. The click hands her a prompt and returns,
// so a control that only tracked its own promise would flash busy for one frame
// and settle. The truth is that the answer arrives later through a different
// surface, so the wait holds until one of three things happens:
//   1. her suggestions for the note RISE above the count at the ask (the answer
//      landed as inline blocks) — reported by `reportSuggestionCount`;
//   2. an Athena entry lands in the note's thread (a suggestions review, or a
//      `comment_on_note` reply);
//   3. the ceiling below passes (she answered in chat, or not at all).
// It is never left spinning forever — an indicator that cannot end is worse
// than none.
import { useCallback, useSyncExternalStore } from 'react';

import { onNoteComment } from './thread/noteThreadStore';

/** How long the pad waits for Athena before it stops claiming she is working.
 *  Two minutes is past her slowest observed turn; beyond it the honest reading
 *  is that she answered in chat rather than with a card. */
export const ASK_CEILING_MS = 120_000;

/** One note's open wait. */
export interface NoteAsk {
  /** ISO stamp of the ask — the presence chip's elapsed clock. */
  since: string;
  /** Open suggestions on the note when she was asked; a rise past it is the
   *  answer arriving. */
  suggestionsAtAsk: number;
}

let asks: Record<string, NoteAsk> = {};
const timers = new Map<string, ReturnType<typeof setTimeout>>();

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of [...listeners]) l();
}

export function subscribeNoteAsks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every open wait, keyed by note id. Same container until something writes. */
export const asksSnapshot = (): Readonly<Record<string, NoteAsk>> => asks;

export function noteAskOf(noteId: string | null | undefined): NoteAsk | null {
  return noteId ? asks[noteId] ?? null : null;
}

/** Note ids with an open wait — what the suggestion watcher re-counts. */
export function askingNoteIds(): string[] {
  return Object.keys(asks);
}

// A thread entry from Athena answers the wait. Attached on the first ask rather
// than at import, so a module that is only read (tests, the bar's type import)
// never registers a subscriber.
let unsubscribeThread: (() => void) | null = null;
function watchThread(): void {
  if (unsubscribeThread) return;
  unsubscribeThread = onNoteComment(({ comment }) => {
    if (comment.authorKind === 'athena') clearAsk(comment.noteId);
  });
}

/**
 * Open (or restart) the wait for a note. A second ask while one is open resets
 * the ceiling and the baseline — the newer question is the one being answered.
 */
export function startAsk(noteId: string, suggestionsAtAsk = 0): void {
  watchThread();
  const existing = timers.get(noteId);
  if (existing) clearTimeout(existing);
  timers.set(
    noteId,
    setTimeout(() => clearAsk(noteId), ASK_CEILING_MS),
  );
  asks = { ...asks, [noteId]: { since: new Date().toISOString(), suggestionsAtAsk } };
  emit();
}

/** End a note's wait. No-op when none is open. */
export function clearAsk(noteId: string): void {
  const timer = timers.get(noteId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(noteId);
  }
  if (!(noteId in asks)) return;
  const { [noteId]: _gone, ...rest } = asks;
  asks = rest;
  emit();
}

/**
 * The note's CURRENT open-suggestion count. Ends the wait when it rose past the
 * count at the ask — the only honest signal that the question was answered with
 * blocks. Cheap to call on every change; a note with no open wait is ignored.
 */
export function reportSuggestionCount(noteId: string, count: number): void {
  const ask = asks[noteId];
  if (ask && count > ask.suggestionsAtAsk) clearAsk(noteId);
}

// --- hooks --------------------------------------------------------------------

/** One note's open wait, or `null`. */
export function useNoteAsking(noteId: string | null | undefined): NoteAsk | null {
  const get = useCallback(() => noteAskOf(noteId), [noteId]);
  return useSyncExternalStore(subscribeNoteAsks, get, get);
}

/** Every open wait — one subscription for a grid of cards. */
export function useNoteAskingMap(): Readonly<Record<string, NoteAsk>> {
  return useSyncExternalStore(subscribeNoteAsks, asksSnapshot, asksSnapshot);
}

// --- test hatch ---------------------------------------------------------------

export function __resetNoteAskStateForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  asks = {};
  unsubscribeThread?.();
  unsubscribeThread = null;
  emit();
}
