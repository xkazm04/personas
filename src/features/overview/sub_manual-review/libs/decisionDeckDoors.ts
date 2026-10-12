/**
 * decisionDeckDoors — how the Overview HISTORY views hand a pending row to the
 * Decision Deck.
 *
 * The rule (operator decision, decision-center wave 3): the Overview tabs stay
 * history views. A row that still waits on a person — a pending review, a
 * pending idea, an open incident, an unread report — opens the ONE global deck
 * (`openDecisionDeck`) on its chip's queue with that row on top; a decided row
 * keeps the tab's own detail modal.
 *
 * Two things live here so the four surfaces cannot disagree about them:
 *  - the DecisionItem id each row becomes. These mirror the roster adapters'
 *    own id templates (`triageAdapters` `review:` / `idea:`, `decisionAdapters`
 *    `incident:` / `report:`); a focus id that matches nothing is harmless —
 *    the deck opens on its first card — but it would silently lose the row the
 *    person clicked, so `decisionDeckDoors.test.ts` pins them against the
 *    adapters' real output.
 *  - re-reading the list when the deck closes, since the deck decides through
 *    the roster's doors, not through the list's store.
 *
 * React-light: one hook, the rest are plain functions.
 */
import { useEffect, useRef } from 'react';

import {
  deckOriginOf,
  openDecisionDeck,
  useDecisionDeckStore,
} from '@/features/decision-center/deck/deckStore';
import type { DecisionChip } from '@/features/decision-center/model/decisionModel';

export const reviewDecisionId = (reviewId: string): string => `review:${reviewId}`;
export const ideaDecisionId = (ideaId: string): string => `idea:${ideaId}`;
export const incidentDecisionId = (incidentId: string): string => `incident:${incidentId}`;
export const reportDecisionId = (reportId: string): string => `report:${reportId}`;

/**
 * Open the deck on one chip's queue. `focusId` puts that card on top; the
 * origin element is the rect the deck grows out of (optional — the deck has
 * its own entrance without one).
 */
export function openChipDeck(
  chip: DecisionChip,
  focusId?: string,
  originEl?: Element | null,
): void {
  openDecisionDeck({
    scope: { kind: 'chip', chip },
    focusId,
    origin: deckOriginOf(originEl),
  });
}

/** True while the global deck is open (any surface's request). */
export function useDecisionDeckOpen(): boolean {
  return useDecisionDeckStore((s) => s.request !== null);
}

/**
 * Re-read a list after the deck closes. The deck writes through the roster's
 * doors, so a list that keeps its own store has to look again — otherwise a
 * row decided in the deck sits on the history view still reading `pending`.
 * Fires on every close, whoever opened the deck: a re-read is cheap and a
 * stale row is not.
 */
export function useReloadOnDeckClose(reload: () => void): void {
  const open = useDecisionDeckOpen();
  const wasOpen = useRef(open);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (wasOpen.current && !open) reloadRef.current();
    wasOpen.current = open;
  }, [open]);
}
