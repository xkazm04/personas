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

/** Where a decided card goes: accept up-right (+4°), reject down-left (−4°), done files up, skip slides under the stack. */
const LEAVE_TO: Record<Exclude<Leave, 'walk'>, TargetAndTransition> = {
  accept: { x: 300, y: -120, rotate: 4, scale: 0.94, opacity: 0, zIndex: 5, transition: { duration: 0.42, ease: [0.4, 0, 0.6, 1] } },
  reject: { x: -280, y: 170, rotate: -4, scale: 0.94, opacity: 0, zIndex: 5, transition: { duration: 0.42, ease: [0.4, 0, 0.6, 1] } },
  done: { y: -160, scale: 0.95, opacity: 0, zIndex: 5, transition: { duration: 0.38 } },
  skip: { y: 34, scale: 0.92, rotateX: 8, opacity: 0, zIndex: -1, transition: { duration: 0.36 } },
};

export const CARD_MOTION = {
  enter: ({ dir, leave }: Custom) =>
    // The next card RISES off the stack: it starts where the first ghost sat.
    leave === 'walk' ? CARD_VARIANTS.enter(dir) : { y: 18, scale: 0.965, rotateX: 5, opacity: 0.6 },
  // A decided card stays ON TOP (zIndex 5) while it flies off; the next one rises beneath it.
  center: { x: 0, y: 0, rotate: 0, rotateX: 0, scale: 1, opacity: 1, zIndex: 1 },
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
  return originFromRect(el.getBoundingClientRect());
}

/** A request's origin rect (`deckOriginOf`) as the morph's offset from the viewport centre. */
export function originFromRect(r: { x: number; y: number; width: number; height: number } | null | undefined): OriginBox | null {
  if (!r || typeof window === 'undefined') return null;
  return {
    dx: r.x + r.width / 2 - window.innerWidth / 2,
    dy: r.y + r.height / 2 - window.innerHeight / 2,
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
      // The plate springs out of the chip / row (300/30); reduced motion is a plain fade.
      transition: still
        ? { duration: sec(MOTION.duration.fast), ease: EASE_OUT }
        : { type: 'spring' as const, stiffness: 300, damping: 30, opacity: { duration: 0.16 } },
    },
    exit: { ...from, transition: { duration: sec(MOTION.duration.fast), ease: 'easeIn' as const } },
  };
}

/** Stamp that lands on a card the moment it is decided. */
export const STAMP_MOTION = {
  initial: { opacity: 0, scale: 1.9, rotate: -16 },
  animate: { opacity: 1, scale: 1, rotate: -7, transition: { type: 'spring' as const, stiffness: 620, damping: 24 } },
};

/** The light ring that bursts out from under the stamp as it lands. */
export const BURST_MOTION = {
  initial: { opacity: 0.9, scale: 0.4 },
  animate: { opacity: 0, scale: 2.4, transition: { duration: 0.45, ease: EASE_OUT } },
};

/** Card content arrives a beat after its plate lands. */
export const CONTENT_FADE = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { delay: 0.08, duration: 0.16 } } };
