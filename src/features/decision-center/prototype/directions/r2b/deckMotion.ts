/**
 * R2-B motion — the deck's vocabulary of movement, grown from the TriageFocus
 * lineage (`triageFocusMotion.ts`: the 300 px card slide and its 300/30
 * spring are reused verbatim for walking, so a reviewer who knows the old
 * deck already knows this one).
 *
 * On top of that:
 *  - ORIGIN: the deck grows out of the segment or peek row that opened it and
 *    shrinks back into it on close.
 *  - LEAVE: a decided card leaves along its verdict's meaning — accept up and
 *    right with a +4° tilt, reject down and left at −4°, done files upward,
 *    skip slides UNDER the stack. The next card rises off the stack.
 *  - STAMP: a 150 ms machined label (verb + glyph) lands before the card goes.
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
  accept: { x: 280, y: -90, rotate: 4, scale: 0.94, opacity: 0, zIndex: 2 },
  reject: { x: -240, y: 170, rotate: -4, scale: 0.94, opacity: 0, zIndex: 2 },
  done: { y: -150, scale: 0.96, opacity: 0, zIndex: 2 },
  skip: { y: 46, scale: 0.9, opacity: 0, zIndex: 0 },
};

export const CARD_MOTION = {
  enter: ({ dir, leave }: Custom) =>
    leave === 'walk' ? CARD_VARIANTS.enter(dir) : { y: 22, scale: 0.965, opacity: 0 },
  center: { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, zIndex: 1 },
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
      transition: still
        ? { duration: sec(MOTION.duration.fast), ease: EASE_OUT }
        : { type: 'spring' as const, stiffness: 300, damping: 30, opacity: { duration: sec(MOTION.duration.fast) } },
    },
    exit: { ...from, transition: { duration: sec(MOTION.duration.fast), ease: 'easeIn' as const } },
  };
}

/** The ghost cards under the top one: scale / drop / fade per depth. */
export const GHOSTS = [
  { scale: 0.965, y: 12, opacity: 0.75 },
  { scale: 0.93, y: 24, opacity: 0.4 },
] as const;

/** Stamp that lands on a card the moment it is decided — 150 ms, no bounce. */
export const STAMP_MOTION = {
  initial: { opacity: 0, scale: 1.22 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.15, ease: EASE_OUT } },
};
