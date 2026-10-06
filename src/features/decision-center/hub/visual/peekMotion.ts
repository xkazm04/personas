/**
 * The peek's motion (R2-C): the glass unfolds down out of its chip, rows
 * arrive in a short stagger, and a decided row leaves toward its verdict —
 * accept to the right, reject to the left. Durations ride the `MOTION` ladder;
 * reduced motion collapses everything to a fade.
 */
import type { TargetAndTransition, Transition, Variants } from 'framer-motion';

import { MOTION } from '@/lib/utils/designTokens';

const sec = (ms: number) => ms / 1000;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const peekTransition: Transition = { duration: sec(MOTION.duration.fast), ease: EASE_OUT };

export const PEEK_ENTER = (still: boolean): TargetAndTransition =>
  still ? { opacity: 0 } : { opacity: 0, y: -8, scaleY: 0.94 };

export const PEEK_EXIT = (still: boolean): TargetAndTransition =>
  still ? { opacity: 0 } : { opacity: 0, y: -6, scaleY: 0.96 };

/** Row stagger step, in seconds. */
const STAGGER = 0.035;

export const rowEnter = (index: number, still: boolean): TargetAndTransition => ({
  opacity: 1,
  y: 0,
  transition: { delay: still ? 0 : index * STAGGER, duration: sec(MOTION.duration.fast) },
});

/** Exit reads the presence `custom` (the verdict's direction), not stale props. */
export const ROW_LEAVE: Variants = {
  leave: (dir: number) => ({
    opacity: 0,
    x: dir * 160,
    filter: 'blur(2px)',
    transition: { duration: sec(MOTION.duration.normal) },
  }),
};
