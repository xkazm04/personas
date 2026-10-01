/**
 * How the training overlay's hand (the question card, the fan, the offers and
 * the composer) leaves the blueprint and comes back to it (spark
 * twin-portable-blueprint). Full motion reuses the dealer's own vocabulary
 * (`DEALER_VARIANTS`: dealt in from above, lifted away on an answer), so the
 * hand moves the way a single card always has.
 *
 * Reduced motion keeps the beat legible as a plain fade: `useMotionVariants`
 * would collapse it to an instant swap, and a hand that vanishes and reappears
 * with no transition reads as a glitch rather than a beat.
 */
import type { Variants } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { DEALER_VARIANTS } from '../experience/cardMotion';

const FADE = { duration: 0.15, ease: 'linear' } as const;

/** The same state names as `DEALER_VARIANTS`, opacity only. */
export const HAND_FADE_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: FADE },
  exitAccept: { opacity: 0, transition: FADE },
  exitSkip: { opacity: 0, transition: FADE },
  exitNone: { opacity: 0, transition: FADE },
};

/** The hand's variants for the current motion preference. */
export function useHandVariants(): Variants {
  return useReducedMotion() ? HAND_FADE_VARIANTS : DEALER_VARIANTS;
}
