/**
 * Motion vocabulary for the experience table. Module-scope variants so
 * `useMotionVariants` can memoize on identity. Custom resolvers (the deal
 * stagger) branch on `shouldAnimate` at the call site — `toReducedVariants`
 * passes functions through.
 */

import type { Variants } from 'framer-motion';

/** Fan angles for up to three suggestion cards, left to right. */
export const FAN_ROTATE = [-7, 0, 7] as const;
export const FAN_Y = [10, 0, 10] as const;
export const FAN_X = [-12, 0, 12] as const;

export const DEALER_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exitAccept: { opacity: 0, y: -36, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
  exitSkip: { opacity: 0, x: 64, rotate: 6, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
  exitNone: { opacity: 0, transition: { duration: 0.16 } },
};

export const CARD_HOVER = {
  rest: { y: 0, scale: 1 },
  hover: { y: -14, scale: 1.04 },
  picked: { y: -18, scale: 1.06 },
};

export const REWARD_VARIANTS: Variants = {
  hidden: { opacity: 0, scale: 0.86 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  gone: { opacity: 0, scale: 1.08, transition: { duration: 0.2 } },
};

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
