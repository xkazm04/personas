// The slide that makes a queue feel like a queue.
//
// Lifted verbatim (numbers included) from the Overview manual-review flow's
// `cardVariants` / `decisionVariants`, which the operator judged the better of
// the app's two triage experiences. The direction is the whole point: the card
// leaves towards the side you came from, so prev and next are distinguishable
// without reading the counter.
//
// Kept in its own module so the component files stay under the 200-line limit
// and so a second surface can animate a card identically without importing a
// component to get at a constant.

/** Horizontal travel of the ITEM card, in px. */
const CARD_TRAVEL = 300;
/** Horizontal travel of the inner decision-option card, in px. */
const OPTION_TRAVEL = 200;

/** `custom` is the direction: +1 forward through the queue, -1 back. */
export const CARD_VARIANTS = {
  enter: (dir: number) => ({ x: dir > 0 ? CARD_TRAVEL : -CARD_TRAVEL, opacity: 0, scale: 0.96 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -CARD_TRAVEL : CARD_TRAVEL, opacity: 0, scale: 0.96 }),
};

export const OPTION_VARIANTS = {
  enter: (dir: number) => ({ x: dir > 0 ? OPTION_TRAVEL : -OPTION_TRAVEL, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -OPTION_TRAVEL : OPTION_TRAVEL, opacity: 0 }),
};

export const CARD_SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const;
export const OPTION_SPRING = { type: 'spring', stiffness: 400, damping: 35 } as const;

/**
 * The reduced-motion answer: cross-fade in place, no travel.
 *
 * A spring slide is exactly the kind of large-displacement transform the
 * `prefers-reduced-motion` guidance is about, and this one fires on every
 * verdict — the busiest animation on a triage surface.
 */
export const STILL_VARIANTS = {
  enter: { x: 0, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: 0, opacity: 0 },
};

export const STILL_SPRING = { duration: 0.12 } as const;
