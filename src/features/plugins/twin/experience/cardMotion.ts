/**
 * Motion vocabulary for the Twin experience, in one place.
 *
 * Module-scope variants so `useMotionVariants` can memoize on identity; the
 * per-card fan offsets branch on `shouldAnimate` at the call site, because
 * `toReducedVariants` passes functions through untouched.
 *
 * Nothing here loops, so there is nothing for the reduced-motion gate to stop
 * beyond the transforms it already strips.
 */

import type { Variants } from 'framer-motion';

/** Fan angles for up to three suggestion cards, left to right. */
export const FAN_ROTATE = [-7, 0, 7] as const;
export const FAN_Y = [10, 0, 10] as const;
export const FAN_X = [-12, 0, 12] as const;

/**
 * The question card, and how the one it replaces leaves. The direction carries
 * the verdict: a played question lifts away, a skipped one is swept aside.
 */
export const DEALER_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exitAccept: { opacity: 0, y: -36, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
  exitSkip: { opacity: 0, x: 64, rotate: 6, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
  exitNone: { opacity: 0, transition: { duration: 0.16 } },
};

/**
 * Hover lift for a suggestion card. The picked card's lift lives in its own
 * `animate` object, so there is no second variant here to drift from it.
 */
export const CARD_HOVER = { y: -14, scale: 1.04 };

export const FORGE_STAGGER: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

export const FORGE_ITEM: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * A layer docked to the right edge of the table. Not a module constant like
 * the rest: it is built per call because the reduced variant has to collapse
 * the slide to a plain fade rather than merely shorten it — a drawer that
 * still travels 100% of its width is the whole motion, not a decoration on it.
 */
export function layerVariants(reduced: boolean): Variants {
  if (reduced) {
    return {
      enter: { opacity: 0 },
      rest: { opacity: 1, transition: { duration: 0.15 } },
      gone: { opacity: 0, transition: { duration: 0.15 } },
    };
  }
  return {
    enter: { opacity: 0.4, x: '100%' },
    rest: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
    gone: { opacity: 0.4, x: '100%', transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  };
}
