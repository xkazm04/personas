/**
 * P2 motion — the deck's whole vocabulary of movement, grown from the
 * TriageFocus lineage (`triageFocusMotion.ts`: the 300 px card slide and its
 * 300/30 spring are reused verbatim for walking, so a reviewer who knows the
 * old deck already knows this one).
 *
 * What P2 adds on top:
 *  - ORIGIN: the deck grows out of the chip or peek row that opened it and
 *    shrinks back into it on close.
 *  - LEAVE: a decided card leaves toward its verdict's meaning — approve
 *    flies up-right onto the "done" pile, reject drops away, done files
 *    upward, skip slides under the deck. The next card rises off the stack.
 *  - Reduced motion: every one of those collapses to a short cross-fade.
 */
import type { TargetAndTransition, Transition } from 'framer-motion';
import { CARD_SPRING, CARD_VARIANTS } from '@/features/shared/components/decisions/triageFocusMotion';
import { MOTION } from '@/lib/utils/designTokens';

export type Leave = 'walk' | 'accept' | 'reject' | 'skip' | 'done';

const sec = (ms: number) => ms / 1000;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export interface Custom { dir: 1 | -1; leave: Leave }

const LEAVE_TO: Record<Exclude<Leave, 'walk'>, TargetAndTransition> = {
  accept: { x: 240, y: -70, rotate: 7, scale: 0.92, opacity: 0 },
  reject: { x: -60, y: 200, rotate: -9, scale: 0.9, opacity: 0 },
  done: { y: -140, scale: 0.95, opacity: 0 },
  skip: { y: 40, scale: 0.88, opacity: 0 },
};

export const CARD_MOTION = {
  enter: ({ dir, leave }: Custom) =>
    leave === 'walk' ? CARD_VARIANTS.enter(dir) : { y: 26, scale: 0.95, opacity: 0 },
  center: { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 },
  exit: ({ dir, leave }: Custom) => (leave === 'walk' ? CARD_VARIANTS.exit(dir) : LEAVE_TO[leave]),
};

export const CARD_TRANSITION: Transition = CARD_SPRING;

export const STILL_CARD = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};
export const STILL_TRANSITION: Transition = { duration: sec(MOTION.duration.fast) / 1.5 };

/** Where the deck was opened from, as an offset from the viewport centre. */
export interface OriginBox { dx: number; dy: number; scale: number }

export function originFrom(el: Element | null | undefined): OriginBox | null {
  if (!el || typeof window === 'undefined') return null;
  const r = el.getBoundingClientRect();
  return {
    dx: r.left + r.width / 2 - window.innerWidth / 2,
    dy: r.top + r.height / 2 - window.innerHeight / 2,
    scale: Math.max(0.08, Math.min(0.5, r.width / 900)),
  };
}

export function originMotion(origin: OriginBox | null, still: boolean) {
  const from = still || !origin
    ? { opacity: 0, scale: still ? 1 : 0.94 }
    : { opacity: 0, x: origin.dx, y: origin.dy, scale: origin.scale };
  return {
    initial: from,
    animate: {
      opacity: 1, x: 0, y: 0, scale: 1,
      transition: { duration: sec(still ? MOTION.duration.fast : MOTION.duration.normal), ease: EASE_OUT, delay: still ? 0 : 0.08 },
    },
    exit: { ...from, transition: { duration: sec(MOTION.duration.fast), ease: 'easeIn' as const } },
  };
}

/** Stamp that lands on a card the moment it is decided. */
export const STAMP_MOTION = {
  initial: { opacity: 0, scale: 1.6, rotate: -14 },
  animate: { opacity: 1, scale: 1, rotate: -8, transition: { type: 'spring' as const, stiffness: 520, damping: 26 } },
};
