import { useMemo, useSyncExternalStore } from 'react';

const MQ = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

function subscribe(cb: () => void) {
  MQ?.addEventListener('change', cb);
  return () => MQ?.removeEventListener('change', cb);
}

function getSnapshot() { return MQ?.matches ?? false; }

/** Drop-in replacement for framer-motion's `useReducedMotion`. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export interface MotionConfig {
  /** Whether animations should play. `false` when user prefers reduced motion. */
  shouldAnimate: boolean;
  /** Transition duration -- near-zero when reduced motion is preferred. */
  duration: number;
  /** Spring config -- instant tween when reduced motion is preferred. */
  spring: { type: 'spring'; stiffness: number; damping: number } | { type: 'tween'; duration: number };
  /** Standard transition object usable in Framer Motion `transition` props. */
  transition: Record<string, unknown>;
  /** Stagger delay for list/grid children. */
  staggerDelay: number;
}

const FULL_MOTION: MotionConfig = {
  shouldAnimate: true,
  duration: 0.25,
  spring: { type: 'spring', stiffness: 300, damping: 25 },
  transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
  staggerDelay: 0.04,
};

const REDUCED_MOTION: MotionConfig = {
  shouldAnimate: false,
  duration: 0.01,
  spring: { type: 'tween', duration: 0 },
  transition: { duration: 0.01, ease: 'linear' },
  staggerDelay: 0,
};

/**
 * Returns motion configuration that respects the user's `prefers-reduced-motion`
 * OS preference. Use the returned values in Framer Motion `transition` props
 * or to conditionally skip animation logic.
 *
 * For most components, wrapping the app in `<MotionConfig reducedMotion="user">`
 * is sufficient. Use this hook when you need programmatic control (e.g.
 * conditional rendering, computed animation values, or non-Framer animations).
 */
export function useMotion(): MotionConfig {
  const prefersReducedMotion = useReducedMotion();
  return useMemo(
    () => (prefersReducedMotion ? REDUCED_MOTION : FULL_MOTION),
    [prefersReducedMotion],
  );
}
