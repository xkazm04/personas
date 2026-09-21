/**
 * Card choreography for the Twin table, in one place.
 *
 * Every card movement means something, and the direction carries it:
 * - an answer is DEALT from the question card down into the hand;
 * - a PLAYED answer flies up into the question it answers;
 * - a SKIPPED question and its hand are swept off to the left, the discard;
 * - a KEPT offer sends a token flying right, toward the twin's card; the
 *   turn's offers drop away when the next question clears them.
 *
 * Each builder takes `reduced` and returns opacity-only variants when the
 * person asked for less motion (OS setting or the in-app toggle, both read by
 * `useReducedMotion`). Nothing here loops; the only looping motion on the
 * table is the CSS foil, which `experience.css` stops on its own.
 */

import type { Transition, Variants } from 'framer-motion';
import { MOTION } from '@/lib/utils/designTokens';

/** What happened to the question that is leaving. Drives every exit. */
export type TableVerdict = 'played' | 'skipped' | null;

export const CARD_SPRING: Transition = { type: 'spring', ...MOTION.spring.snappy };
const EASE = [0.22, 1, 0.36, 1] as const;
const FADE: Transition = { duration: 0.16 };

/** Where a hand card rests in the fan. The middle card sits highest. */
export function fanPose(index: number, count: number): { rotate: number; y: number } {
  const offset = index - (count - 1) / 2;
  return { rotate: offset * 3.5, y: Math.abs(offset) * 9 };
}

/**
 * What the hand passes down as framer `custom`. The SAME shape reaches a live
 * card (its own prop) and an exiting one (AnimatePresence's, which replaces a
 * removed card's props) — so which card was played is carried as an index,
 * never as a per-card flag an exiting card could not receive.
 */
export interface HandCustom {
  picked: number;
  verdict: TableVerdict;
}

/** Variants for the card at `index` of `count`; its position is closed over. */
export function handCardVariants(reduced: boolean, index: number, count: number): Variants {
  if (reduced) {
    return {
      dealt: { opacity: 0 },
      rest: { opacity: 1, transition: FADE },
      gone: { opacity: 0, transition: FADE },
    };
  }
  const pose = fanPose(index, count);
  return {
    dealt: {
      opacity: 0,
      y: -240,
      x: (index - (count - 1) / 2) * -60,
      rotate: -14 + index * 9,
      scale: 0.55,
    },
    rest: ({ picked }: HandCustom) => {
      const up = picked === index;
      return {
        opacity: 1,
        x: 0,
        y: up ? pose.y - 26 : pose.y,
        rotate: up ? pose.rotate * 0.4 : pose.rotate,
        scale: up ? 1.04 : 1,
        transition: { ...CARD_SPRING, delay: 0.05 + index * 0.07 },
      };
    },
    gone: ({ picked, verdict }: HandCustom) => {
      if (verdict === 'skipped') {
        return { opacity: 0, x: -520, rotate: -24, transition: { duration: 0.34, ease: EASE } };
      }
      if (verdict === 'played' && picked === index) {
        return { opacity: 0, y: -300, scale: 0.72, rotate: 0, transition: { duration: 0.34, ease: EASE } };
      }
      return { opacity: 0, y: 90, transition: { duration: 0.22, ease: 'easeIn' } };
    },
  };
}

export function dealerCardVariants(reduced: boolean): Variants {
  if (reduced) {
    return {
      enter: { opacity: 0 },
      rest: { opacity: 1, transition: FADE },
      gone: { opacity: 0, transition: FADE },
    };
  }
  return {
    enter: { opacity: 0, rotateY: 80, y: -18 },
    rest: { opacity: 1, rotateY: 0, y: 0, x: 0, rotate: 0, transition: { duration: 0.42, ease: EASE } },
    gone: (verdict: TableVerdict) =>
      verdict === 'skipped'
        ? { opacity: 0, x: -460, rotate: -10, transition: { duration: 0.34, ease: EASE } }
        : { opacity: 0, y: -24, scale: 0.97, transition: { duration: 0.2, ease: 'easeIn' } },
  };
}

export function lootCardVariants(reduced: boolean): Variants {
  if (reduced) {
    return {
      enter: { opacity: 0 },
      rest: { opacity: 1, transition: FADE },
      gone: { opacity: 0, transition: FADE },
    };
  }
  return {
    enter: { opacity: 0, rotateY: 160, scale: 0.8 },
    rest: (index: number) => ({
      opacity: 1,
      rotateY: 0,
      scale: 1,
      transition: { ...CARD_SPRING, delay: 0.25 + index * 0.12 },
    }),
    // Leaving only happens when the next question clears the turn's record.
    gone: { opacity: 0, y: 70, rotate: 6, transition: { duration: 0.25, ease: 'easeIn' } },
  };
}

/** A short lift for anything the pointer rests on. Off under reduced motion. */
export function hoverLift(reduced: boolean) {
  return reduced ? undefined : { y: -8, transition: { duration: 0.18 } };
}
