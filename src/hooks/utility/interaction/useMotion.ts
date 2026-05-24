import { useMemo, useSyncExternalStore } from 'react';
import type { Variants } from 'framer-motion';

const MQ = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

function subscribe(cb: () => void) {
  MQ?.addEventListener('change', cb);
  return () => MQ?.removeEventListener('change', cb);
}

function getSnapshot() { return MQ?.matches ?? false; }

/** Drop-in replacement for framer-motion's `useReducedMotion`. */
export function useReducedMotion(): boolean {
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

// ---------------------------------------------------------------------------
// useMotionVariants — the single reduced-motion gate for Framer `variants`
// ---------------------------------------------------------------------------

/**
 * Transform / displacement target keys that produce *movement* on screen.
 * These are the vestibular hazard. We strip them in reduced-motion mode so the
 * element snaps to its resting position instead of sliding/scaling/rotating in.
 * Opacity (and color, etc.) is intentionally preserved — a cross-fade is
 * generally acceptable under `prefers-reduced-motion` and mirrors framer-motion's
 * own `<MotionConfig reducedMotion="user">` behaviour (transforms off, opacity on).
 */
const TRANSFORM_KEYS = new Set([
  'x', 'y', 'z',
  'scale', 'scaleX', 'scaleY', 'scaleZ',
  'rotate', 'rotateX', 'rotateY', 'rotateZ',
  'skew', 'skewX', 'skewY',
  'translateX', 'translateY', 'translateZ',
  'perspective',
]);

/** Transition keys that introduce delay, looping, or staggered cascades. */
const TIMING_KEYS = new Set([
  'staggerChildren', 'delayChildren', 'staggerDirection',
  'repeat', 'repeatType', 'repeatDelay', 'delay',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reduceTransition(transition: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(transition)) {
    if (TIMING_KEYS.has(key)) continue;
    // Nested per-property transitions (e.g. transition: { opacity: { duration } }).
    if (isPlainObject(value)) {
      out[key] = reduceTransition(value);
    } else {
      out[key] = value;
    }
  }
  // Collapse to an instant tween regardless of the original spring/duration.
  out.type = 'tween';
  out.duration = 0;
  return out;
}

function reduceTarget(target: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    if (TRANSFORM_KEYS.has(key)) continue; // drop movement → snap to rest
    if (key === 'transition' && isPlainObject(value)) {
      out.transition = reduceTransition(value);
      continue;
    }
    // Keyframe arrays (e.g. opacity: [0, 1, 0]) collapse to their final value.
    if (Array.isArray(value)) {
      out[key] = value.length ? value[value.length - 1] : value;
      continue;
    }
    out[key] = value;
  }
  if (!('transition' in out)) {
    out.transition = { type: 'tween', duration: 0 };
  }
  return out;
}

/**
 * Pure transform: returns a reduced-motion clone of a Framer `Variants` object.
 * Movement (translate/scale/rotate) and timing (stagger/delay/repeat) are
 * removed; opacity and final keyframe values are preserved with an instant
 * transition. Safe to call at module scope for static variant constants.
 */
export function toReducedVariants(variants: Variants): Variants {
  const out: Variants = {};
  for (const [state, def] of Object.entries(variants)) {
    if (isPlainObject(def)) {
      out[state] = reduceTarget(def) as Variants[string];
    } else {
      // Variant resolver functions are passed through untouched — the caller
      // owns their motion logic; reduced-motion handling belongs inside them.
      out[state] = def;
    }
  }
  return out;
}

/**
 * The single reduced-motion gate for Framer `variants`. Pass your full-motion
 * variants; get back either the originals (motion allowed) or an instant,
 * movement-free clone (user prefers reduced motion). Memoized on the variants
 * identity, so define the input at module scope or with `useMemo`.
 *
 * ```tsx
 * const variants = useMotionVariants(fadeUp);
 * <motion.div variants={variants} initial="hidden" animate="visible" />
 * ```
 */
export function useMotionVariants(variants: Variants): Variants {
  const prefersReducedMotion = useReducedMotion();
  return useMemo(
    () => (prefersReducedMotion ? toReducedVariants(variants) : variants),
    [prefersReducedMotion, variants],
  );
}
