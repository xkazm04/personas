/**
 * Transcript windowing — render only the recent rounds of a long conversation.
 *
 * The panel already pages older history in from the backend, but nothing ever
 * dropped rows on the way OUT: a day-long thread ends up with several hundred
 * live `Bubble`s (each one a `MarkdownRenderer`) mounted at once, and every
 * store write re-reconciles all of them. That is the "long ongoing
 * conversations get sluggish" complaint.
 *
 * So the transcript renders the last N ROUNDS — a round being one user message
 * and everything Athena said in reply. Rounds, not messages, because cutting
 * mid-turn would orphan a reply from the question that caused it. Everything
 * older stays in the store (search, export, and Athena's own memory are
 * unaffected) and comes back on demand: the user clicks the "earlier messages"
 * divider, or simply scrolls to the top, and the window grows a page at a time
 * until the whole loaded transcript is on screen — at which point
 * `useTranscriptPages` takes over and fetches genuinely older rows.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanionMessage } from '@/api/companion';

/** Rounds kept mounted by default. */
export const DEFAULT_VISIBLE_ROUNDS = 10;

/** Rounds added per "show earlier" step. */
export const ROUND_EXPAND_STEP = 10;

/**
 * Index of the first message belonging to the last `rounds` rounds.
 *
 * Walks backwards counting user messages; the round boundary IS the user
 * message that opened it, so the returned index always lands ON a user turn
 * and a reply is never severed from the question that produced it. Returns 0
 * when the transcript holds fewer rounds than asked for — nothing to hide.
 */
export function windowStartIndex(messages: CompanionMessage[], rounds: number): number {
  if (rounds <= 0 || messages.length === 0) return 0;
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    seen += 1;
    // The Nth user message from the end opens the oldest round we keep.
    if (seen === rounds) return i;
  }
  return 0;
}

export interface TranscriptWindow {
  /** The slice to render. */
  visible: CompanionMessage[];
  /** How many loaded messages are hidden above the window. */
  hiddenCount: number;
  /** Nothing is hidden — scroll-to-top may page the backend. */
  fullyExpanded: boolean;
  /** Reveal another {@link ROUND_EXPAND_STEP} rounds. */
  showEarlier: () => void;
}

/**
 * Windowed view of the transcript, reset whenever the thread changes.
 *
 * The window is recomputed from the END of the list, so new turns arriving
 * simply push the oldest round out of view — the user's reading position and
 * expansion choice are preserved (`rounds` is state, the slice is derived).
 */
export function useTranscriptWindow(
  messages: CompanionMessage[],
  conversationId: string,
): TranscriptWindow {
  const [rounds, setRounds] = useState(DEFAULT_VISIBLE_ROUNDS);

  // A thread switch is a different conversation entirely — re-collapse.
  useEffect(() => {
    setRounds(DEFAULT_VISIBLE_ROUNDS);
  }, [conversationId]);

  const start = useMemo(() => windowStartIndex(messages, rounds), [messages, rounds]);

  const visible = useMemo(
    () => (start === 0 ? messages : messages.slice(start)),
    [messages, start],
  );

  const showEarlier = useCallback(() => {
    setRounds((r) => r + ROUND_EXPAND_STEP);
  }, []);

  return {
    visible,
    hiddenCount: start,
    fullyExpanded: start === 0,
    showEarlier,
  };
}
