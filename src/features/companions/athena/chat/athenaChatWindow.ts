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
 * Hard cap on mounted messages, whatever the round count says.
 *
 * Rounds alone do not bound this transcript. Measured on the live default
 * thread: 50 loaded messages contain **6 user messages** — 15 assistant, 9
 * system, and the rest machine rows — so a 10-round window never finds a tenth
 * user turn, returns 0, and mounts everything. The windowing shipped and did
 * nothing, because it was designed against a synthetic transcript of alternating
 * user/assistant pairs and this app's transcripts are ~20% user.
 *
 * So the window is whichever boundary hides MORE, and the message cap is the one
 * that bites on a system-heavy thread. It is still snapped to a round boundary,
 * so a reply is never severed from its question.
 */
export const MAX_VISIBLE_MESSAGES = 30;

/** Messages added per "show earlier" step, alongside the round step. */
export const MESSAGE_EXPAND_STEP = 30;

/**
 * Index of the first message belonging to the last `rounds` rounds.
 *
 * Walks backwards counting user messages; the round boundary IS the user
 * message that opened it, so the returned index always lands ON a user turn
 * and a reply is never severed from the question that produced it. Returns 0
 * when the transcript holds fewer rounds than asked for — nothing to hide.
 */
export function windowStartIndex(
  messages: CompanionMessage[],
  rounds: number,
  maxMessages = MAX_VISIBLE_MESSAGES,
): number {
  if (rounds <= 0 || messages.length === 0) return 0;

  // Boundary 1 — the Nth user message from the end opens the oldest kept round.
  let roundStart = 0;
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    seen += 1;
    if (seen === rounds) {
      roundStart = i;
      break;
    }
  }

  // Boundary 2 — the message cap, snapped BACKWARDS to the nearest user message
  // so the window still opens on a whole round. Snapping backwards (earlier)
  // rather than forwards means the cap is a target, not a guillotine: we would
  // rather mount a few extra messages than open mid-turn.
  let capStart = Math.max(0, messages.length - maxMessages);
  while (capStart > 0 && messages[capStart]?.role !== 'user') capStart -= 1;

  // Whichever hides more wins.
  return Math.max(roundStart, capStart);
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
  const [maxMessages, setMaxMessages] = useState(MAX_VISIBLE_MESSAGES);

  // A thread switch is a different conversation entirely — re-collapse.
  useEffect(() => {
    setRounds(DEFAULT_VISIBLE_ROUNDS);
    setMaxMessages(MAX_VISIBLE_MESSAGES);
  }, [conversationId]);

  const start = useMemo(
    () => windowStartIndex(messages, rounds, maxMessages),
    [messages, rounds, maxMessages],
  );

  const visible = useMemo(
    () => (start === 0 ? messages : messages.slice(start)),
    [messages, start],
  );

  // Both boundaries move together — relaxing only one leaves the other pinning
  // the window and the button appears to do nothing.
  const showEarlier = useCallback(() => {
    setRounds((r) => r + ROUND_EXPAND_STEP);
    setMaxMessages((m) => m + MESSAGE_EXPAND_STEP);
  }, []);

  return {
    visible,
    hiddenCount: start,
    fullyExpanded: start === 0,
    showEarlier,
  };
}
