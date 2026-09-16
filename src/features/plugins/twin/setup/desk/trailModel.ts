/**
 * The Desk's conversation trail — how the transcript becomes two lines of
 * context above the question the guide is asking now.
 *
 * The Desk asks one question at a time, and that question used to appear as a
 * bare prompt out of nowhere: correct, keyboard-fast, and impossible to follow.
 * The fix is not a chat log (that is the surface the Desk exists instead of);
 * it is a THREAD: the last exchanges, compact, with everything older folded
 * into one row.
 *
 * Two shapes the derivation has to get right, both of them real:
 *  - the live guide turn is already the tail of `history`, so it must be
 *    dropped here or it renders twice, once as trail and once as the question;
 *  - a DECLINED question leaves a guide entry with no user entry after it
 *    (`skip()` writes no transcript line), so an exchange carries
 *    `answer: null` rather than being dropped — "not this one" is an answer and
 *    the thread should show it.
 */

import type { SetupHistoryEntry, SetupProposal } from '../setupContract';

export type DeskVerdictResolution = 'accepted' | 'edited' | 'dismissed';

/** What the user did with one typed value the guide offered in that turn. */
export interface DeskVerdict {
  id: string;
  kind: SetupProposal['kind'];
  channel: string | null;
  resolution: DeskVerdictResolution;
}

/** One question and what came back. */
export interface DeskExchange {
  id: string;
  question: string;
  /** `null` when the question was declined rather than answered. */
  answer: string | null;
  verdicts: DeskVerdict[];
}

export interface DeskTrail {
  exchanges: DeskExchange[];
  /** What stays visible: the last `TRAIL_RECENT` exchanges. */
  recent: DeskExchange[];
  /** Everything older, behind the "earlier" row. */
  earlier: DeskExchange[];
  /** True while nothing has been exchanged yet — the turn OPENS the thread. */
  isOpening: boolean;
}

/** How many exchanges stay open. Two is the thread; more is a transcript. */
export const TRAIL_RECENT = 2;

function verdictsOf(entry: SetupHistoryEntry): DeskVerdict[] {
  const resolutions = entry.resolutions;
  if (!resolutions || !entry.proposals) return [];
  const out: DeskVerdict[] = [];
  for (const proposal of entry.proposals) {
    const resolution = resolutions[proposal.id];
    if (resolution) {
      out.push({ id: proposal.id, kind: proposal.kind, channel: proposal.channel, resolution });
    }
  }
  return out;
}

/**
 * Fold the transcript into exchanges, minus the turn being asked right now.
 *
 * @param history   the session transcript, oldest first
 * @param liveQuestion the question currently on the desk, or null
 */
export function deriveDeskTrail(
  history: readonly SetupHistoryEntry[],
  liveQuestion: string | null,
): DeskTrail {
  const entries = [...history];
  const tail = entries[entries.length - 1];
  if (tail && tail.role === 'guide' && liveQuestion !== null && tail.text === liveQuestion) {
    entries.pop();
  }

  const exchanges: DeskExchange[] = [];
  let pending: DeskExchange | null = null;
  for (const entry of entries) {
    if (entry.role === 'guide') {
      if (pending) exchanges.push(pending);
      pending = { id: entry.id, question: entry.text, answer: null, verdicts: verdictsOf(entry) };
      continue;
    }
    if (pending) {
      pending.answer = entry.text;
      exchanges.push(pending);
      pending = null;
    } else {
      // A user line with no question before it (a typed answer that opened the
      // session). It is still part of the thread.
      exchanges.push({ id: entry.id, question: '', answer: entry.text, verdicts: [] });
    }
  }
  if (pending) exchanges.push(pending);

  const split = Math.max(0, exchanges.length - TRAIL_RECENT);
  return {
    exchanges,
    recent: exchanges.slice(split),
    earlier: exchanges.slice(0, split),
    isOpening: exchanges.length === 0,
  };
}
