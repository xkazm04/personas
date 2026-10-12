// The slide that makes a queue feel like a queue.
//
// Lifted verbatim (numbers included) from the Overview manual-review flow's
// `cardVariants` / `decisionVariants`, which the operator judged the better of
// the app's two triage experiences. The direction is the whole point: the card
// leaves towards the side you came from, so prev and next are distinguishable
// without reading the counter.
//
// Kept in its own module so a surface can animate a card identically without
// importing a component to get at a constant. TriageFocus, the component it
// was written for, was retired 2026-10-06; the Decision Deck
// (`decision-center/deck/deckMotion.ts`) is its reader now.

/** Horizontal travel of the ITEM card, in px. */
const CARD_TRAVEL = 300;

/** `custom` is the direction: +1 forward through the queue, -1 back. */
export const CARD_VARIANTS = {
  enter: (dir: number) => ({ x: dir > 0 ? CARD_TRAVEL : -CARD_TRAVEL, opacity: 0, scale: 0.96 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -CARD_TRAVEL : CARD_TRAVEL, opacity: 0, scale: 0.96 }),
};

export const CARD_SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const;
