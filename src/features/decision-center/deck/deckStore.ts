/**
 * deckStore — the ONE door into the Decision Deck.
 *
 * The deck (the shared decision modal: approval, backlog, report and chat
 * cards on one stack) is mounted once, globally, by `DecisionDeckHost`. Every
 * surface that wants a human to decide something opens it through
 * `openDecisionDeck` — the Activity hub's peek and Triage all, the Overview
 * lists, the title-bar badge, Council — so there is one modal, one key grammar
 * and one motion language app-wide, and no surface mounts its own copy.
 *
 * Scopes:
 *  - `chip`   the deck walks that chip's roster queue (compareDecision order).
 *  - `all`    the deck walks every chip's queue (Triage all).
 *  - `lane`   the deck walks one mandate lane (setting `lanes`): the items the
 *             backend's lane snapshot put there, in lane order (clause rank,
 *             then age). See `lanes/laneModel`.
 *  - `single` one item the caller already holds, adapted with the roster's own
 *             adapters. Used for a history row (a resolved incident, a read
 *             report): it renders read-only when `readOnly` is set, and never
 *             walks.
 *
 * `focusId` (a DecisionItem id) puts that card on top; the rest of the queue
 * stays reachable with the walk keys. `origin` is the rect the deck morphs out
 * of and back into. `returnTo` tells the hub which peek to reopen when the deck
 * closes (the Esc ladder deck -> peek -> strip).
 */
import { create } from 'zustand';
import type { DecisionChip, DecisionItem } from '../model/decisionModel';
import type { LaneKey } from '../lanes/laneModel';

/** What a hub reopens when the deck closes: a chip's peek or a lane's. */
export type DeckReturn = DecisionChip | LaneKey;

export type DeckRequestScope =
  | { kind: 'chip'; chip: DecisionChip }
  | { kind: 'all' }
  | { kind: 'lane'; lane: LaneKey }
  | { kind: 'single'; item: DecisionItem; readOnly?: boolean };

/** Screen-space rect the deck grows out of. */
export interface DeckOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeckRequest {
  scope: DeckRequestScope;
  focusId?: string;
  origin?: DeckOrigin | null;
  /** The hub chip (or lane) whose peek reopens when the deck closes. */
  returnTo?: DeckReturn | null;
}

interface DeckState {
  /** The open request, or null when the deck is closed. */
  request: DeckRequest | null;
  /** Bumped per open so the host remounts a fresh session. */
  session: number;
  /** Set on close: which peek the hub should reopen. Consumed by the hub. */
  closedReturnTo: { chip: DeckReturn; at: number } | null;
  open: (request: DeckRequest) => void;
  close: () => void;
  consumeReturn: () => void;
}

export const useDecisionDeckStore = create<DeckState>((set, get) => ({
  request: null,
  session: 0,
  closedReturnTo: null,
  open: (request) => set((s) => ({ request, session: s.session + 1, closedReturnTo: null })),
  close: () => {
    const chip = get().request?.returnTo ?? null;
    set({ request: null, closedReturnTo: chip ? { chip, at: Date.now() } : null });
  },
  consumeReturn: () => set({ closedReturnTo: null }),
}));

export function openDecisionDeck(request: DeckRequest): void {
  useDecisionDeckStore.getState().open(request);
}

export function closeDecisionDeck(): void {
  useDecisionDeckStore.getState().close();
}

/** Rect of an element, for `DeckRequest.origin`. */
export function deckOriginOf(el: Element | null | undefined): DeckOrigin | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * From an empty deck to another chip that still holds cards: a fresh opening
 * on that chip. The hub's return (`returnTo`) follows the move only when the
 * deck was opened from the hub in the first place.
 */
export function switchDeckChip(chip: DecisionChip): void {
  const from = useDecisionDeckStore.getState().request;
  openDecisionDeck({ scope: { kind: 'chip', chip }, returnTo: from?.returnTo ? chip : null });
}

/** The lane twin of {@link switchDeckChip}: an empty lane deck moves to a lane still holding cards. */
export function switchDeckLane(lane: LaneKey): void {
  const from = useDecisionDeckStore.getState().request;
  openDecisionDeck({ scope: { kind: 'lane', lane }, returnTo: from?.returnTo ? lane : null });
}
