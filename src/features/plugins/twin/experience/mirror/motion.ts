/**
 * The Mirror's motion vocabulary, in one place.
 *
 * Three moves and no more — the surface is a lane, not a table, so nothing
 * flies across it:
 *  - a question RISES into its frame and the one it replaces sinks away;
 *  - an answer slat arrives on a short stagger, so three read as three;
 *  - a layer SLIDES in from the edge it is docked to, and the lane dims.
 *
 * Every builder takes `reduced` and collapses to opacity when the person asked
 * for less motion (OS setting or the in-app toggle, both via `useReducedMotion`).
 * Nothing here loops; the only looping motion on this surface is the CSS
 * whisper, which `mirror.css` stops on its own.
 */

import type { Transition, Variants } from 'framer-motion';
import { MOTION } from '@/lib/utils/designTokens';

const EASE = [0.22, 1, 0.36, 1] as const;
const FADE: Transition = { duration: MOTION.duration.fast / 1000 };

export const LANE_SPRING: Transition = { type: 'spring', ...MOTION.spring.snappy };

/** The live question, and how the one before it leaves. */
export function askVariants(reduced: boolean): Variants {
  if (reduced) {
    return { enter: { opacity: 0 }, rest: { opacity: 1, transition: FADE }, gone: { opacity: 0, transition: FADE } };
  }
  return {
    enter: { opacity: 0, y: 18, filter: 'blur(3px)' },
    rest: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.38, ease: EASE } },
    gone: { opacity: 0, y: -14, filter: 'blur(3px)', transition: { duration: 0.2, ease: 'easeIn' } },
  };
}

/** One answer slat at `index`. They arrive left to right, 60ms apart. */
export function slatVariants(reduced: boolean, index: number): Variants {
  if (reduced) {
    return { enter: { opacity: 0 }, rest: { opacity: 1, transition: FADE }, gone: { opacity: 0, transition: FADE } };
  }
  return {
    enter: { opacity: 0, y: 14 },
    rest: { opacity: 1, y: 0, transition: { ...LANE_SPRING, delay: 0.06 + index * 0.06 } },
    gone: { opacity: 0, y: 8, transition: { duration: 0.16, ease: 'easeIn' } },
  };
}

/** A layer docked to the right edge of the lane. */
export function layerVariants(reduced: boolean): Variants {
  if (reduced) {
    return { enter: { opacity: 0 }, rest: { opacity: 1, transition: FADE }, gone: { opacity: 0, transition: FADE } };
  }
  return {
    enter: { opacity: 0.4, x: '100%' },
    rest: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } },
    gone: { opacity: 0.4, x: '100%', transition: { duration: 0.22, ease: EASE } },
  };
}

/** The offer that rises over the reply when the guide wants to write something down. */
export function offerVariants(reduced: boolean): Variants {
  if (reduced) {
    return { enter: { opacity: 0 }, rest: { opacity: 1, transition: FADE }, gone: { opacity: 0, transition: FADE } };
  }
  return {
    enter: { opacity: 0, y: 26 },
    rest: { opacity: 1, y: 0, transition: { ...LANE_SPRING } },
    gone: { opacity: 0, y: 14, transition: { duration: 0.2, ease: 'easeIn' } },
  };
}

/** The create act's pieces, revealed as each one becomes relevant. */
export function revealVariants(reduced: boolean, delay = 0): Variants {
  if (reduced) {
    return { enter: { opacity: 0 }, rest: { opacity: 1, transition: FADE }, gone: { opacity: 0, transition: FADE } };
  }
  return {
    enter: { opacity: 0, y: 12 },
    rest: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE, delay } },
    gone: { opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeIn' } },
  };
}
