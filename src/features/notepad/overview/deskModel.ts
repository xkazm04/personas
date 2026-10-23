// Pure filter, highlight and review-key model for the notepad desk.
// No React, no DOM, no stores. Anything the DOM knows (whether a card has a
// bubble up) is measured by the caller and passed IN.
//
// PRUNED 2026-10-19: the 4-column grid's keyboard model (grid walk, selection
// survival, chrome reducer, keymap, rendered-column readers) lived here and had
// no production caller after the grid was retired for the journal on
// 2026-09-23; only its own test still imported it. `git show` recovers it.

export type CardAction =
  | 'ask'
  | 'publish'
  | 'goals'
  | 'thread'
  | 'reply'
  | 'approve'
  | 'reject'
  | 'delete';

export function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesQuery(query: string, title: string, body: string): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return true;
  const hay = `${title}\n${body}`.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

export function splitHighlight(
  text: string,
  query: string,
): { pre: string; hit: string; post: string } | null {
  const tok = tokenizeQuery(query)[0];
  if (!tok) return null;
  const i = text.toLowerCase().indexOf(tok);
  if (i < 0) return null;
  return {
    pre: text.slice(0, i),
    hit: text.slice(i, i + tok.length),
    post: text.slice(i + tok.length),
  };
}

/** What the card knows about its bubble at the moment a review key lands. */
export interface BubbleSnapshot {
  /** A bubble is on screen for the card (and the thread is not). */
  up: boolean;
  /** The bubble carries a review still waiting on the operator. */
  pendingReview: boolean;
  /** The review's `refKind` — `run` rejects with a reason, `suggestion_card` in one tap. */
  refKind: string | null;
}

/** Where a review key lands. */
export type ReviewKeyEffect =
  | 'bubbleComment'
  | 'threadReply'
  | 'approve'
  | 'rejectNow'
  | 'rejectReason'
  | 'thread';

/**
 * `r` / `y` / `n` act on the bubble when one is up — the same place the mouse
 * would — and fall back to the thread otherwise:
 *   - `r` focuses the bubble's inline Comment field, else the thread composer;
 *   - `y` approves the bubble's pending review, else opens the thread;
 *   - `n` rejects a pending suggestion-card review in one tap, opens the
 *     reject-reason field for a pending `run` review (the reason is what the
 *     re-run is told), else opens the thread.
 */
export function reviewKeyEffect(action: 'reply' | 'approve' | 'reject', bubble: BubbleSnapshot): ReviewKeyEffect {
  if (action === 'reply') return bubble.up ? 'bubbleComment' : 'threadReply';
  if (!bubble.up || !bubble.pendingReview) return 'thread';
  if (action === 'approve') return 'approve';
  if (bubble.refKind === 'suggestion_card') return 'rejectNow';
  if (bubble.refKind === 'run') return 'rejectReason';
  return 'thread';
}

/** True when the keystroke belongs to a typing surface — inputs keep their keys. */
export function isTypingSurface(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** A dialog, menu, or listbox on screen owns arrows and letters. */
export function overlayOwnsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}
