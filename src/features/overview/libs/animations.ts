/**
 * Shared framer-motion primitives for the Overview module.
 *
 * Centralizes duration, easing, and variants so every transition in the
 * dashboard breathes at the same rhythm. Components should prefer these
 * over inline `transition={{ ... }}` objects: changing the values here
 * retunes the whole module at once.
 *
 * All variants honour `prefers-reduced-motion` automatically when used with
 * framer-motion's `<MotionConfig reducedMotion="user">` wrapper (already the
 * default behaviour in `motion.div` components that pick up the user agent
 * setting through `useReducedMotion`).
 */
import type { Variants } from 'framer-motion';

// ── Timing tokens ──────────────────────────────────────────────────────

export const TRANSITION_INSTANT = 0.1;
export const TRANSITION_FAST    = 0.18;
export const TRANSITION_NORMAL  = 0.24;
export const TRANSITION_SLOW    = 0.4;

/**
 * Unified ease curve — quartic ease-out. Same shape used across all
 * dashboard transitions to keep the perceived rhythm consistent.
 */
export const EASE_OUT_QUART: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ── Variants ──────────────────────────────────────────────────────────

/** Subtle slide-up + fade. Use on cards, list items, KPI tiles. */
export const fadeUp: Variants = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: TRANSITION_NORMAL, ease: EASE_OUT_QUART } },
};

/** Container that staggers children using `fadeUp` (or any child variant). */
export const staggerContainer: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};

/**
 * Tab / subview swap. Used with `<AnimatePresence mode="wait">` so the
 * outgoing pane finishes its exit before the incoming pane animates in.
 */
export const pageTransition: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: TRANSITION_NORMAL, ease: EASE_OUT_QUART } },
  exit:    { opacity: 0, y: -4, transition: { duration: TRANSITION_FAST,   ease: EASE_OUT_QUART } },
};

/** Below-the-fold reveal — slightly larger travel than `fadeUp`. */
export const revealFromBelow: Variants = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: TRANSITION_SLOW, ease: EASE_OUT_QUART } },
};
