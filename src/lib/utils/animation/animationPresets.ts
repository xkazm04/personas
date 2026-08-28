import { useMemo } from 'react';
import type { Variants } from 'framer-motion';
import { MOTION } from '@/lib/utils/designTokens';
import {
  useMotion,
  useMotionVariants,
  useReducedMotion,
  toReducedVariants,
  type MotionConfig,
} from '@/hooks/utility/interaction/useMotion';

export { useMotion, useMotionVariants, useReducedMotion, toReducedVariants, type MotionConfig };

export const CSS_DURATION_CLASS = {
  snappy: 'duration-snap motion-reduce:duration-0 motion-reduce:transition-none',
  smooth: 'duration-flow motion-reduce:duration-0 motion-reduce:transition-none',
  gentle: 'duration-ease motion-reduce:duration-0 motion-reduce:transition-none',
  SNAP: 'duration-snap motion-reduce:duration-0 motion-reduce:transition-none',
  FLOW: 'duration-flow motion-reduce:duration-0 motion-reduce:transition-none',
  EASE: 'duration-ease motion-reduce:duration-0 motion-reduce:transition-none',
} as const;

export const REDUCED_FRAMER = { duration: 0.01, ease: 'linear' as const };

// -- Standardized ease curve ------------------------------------------
// Used across all transition presets for a consistent spring-like feel.
const EASE_CURVE = [0.22, 1, 0.36, 1] as [number, number, number, number];

// -- Framer Motion transition presets ---------------------------------
// Framer counts in SECONDS, the rest of the app counts in milliseconds, and
// that unit change is the only reason these numbers were ever re-typed. `sec`
// makes the conversion the single difference, so `MOTION.duration` in
// designTokens.ts is the one place a JS-side rung changes.
//
// instant (50ms)  -> tooltips, micro-interactions
// fast    (150ms) -> dropdowns, toggles, small state changes
// normal  (250ms) -> panels, modals, drawers, standard transitions
// slow    (400ms) -> page transitions, wizard steps, large reveals
const sec = (ms: number) => ms / 1000;

export const TRANSITION_NORMAL = { duration: sec(MOTION.duration.normal), ease: EASE_CURVE };
export const TRANSITION_SLOW = { duration: sec(MOTION.duration.slow), ease: EASE_CURVE };

// Named MOTION_PRESETS (not MOTION) to avoid colliding with the MOTION
// duration/delay registry exported by `@/lib/utils/designTokens`, which these
// presets now READ (they used to re-type its four numbers in seconds) --
// see refactor-bughunt-2026-07-10 finding #6.
export const MOTION_PRESETS = {
  snappy: {
    framer: { duration: sec(MOTION.duration.fast), ease: 'easeOut' as const },
    css: CSS_DURATION_CLASS.snappy,
  },
  smooth: {
    framer: { duration: sec(MOTION.duration.normal), ease: 'easeOut' as const },
    css: CSS_DURATION_CLASS.smooth,
  },
  gentle: {
    framer: { duration: sec(MOTION.duration.slow), ease: 'easeOut' as const },
    css: CSS_DURATION_CLASS.gentle,
  },
} as const;

/**
 * Framer twins of `CSS_DURATION_CLASS`, rung for rung.
 *
 * `EASE` used to be `{ type: 'spring', stiffness: 300, damping: 25 }` while
 * `CSS_DURATION_CLASS.EASE` was a 400ms tween — **one word for two different
 * gestures**. A component animating one property in Framer and another in CSS
 * reached for "EASE" both times and got two unrelated motion characters, and a
 * spring cannot be audited against a millisecond cap at all, because it has no
 * duration. The three names now mean the same thing on both sides; the spring
 * lives under its own name, where nothing mistakes it for a rung of the ladder.
 */
export const MOTION_TIMING = {
  SNAP: MOTION_PRESETS.snappy.framer,
  FLOW: MOTION_PRESETS.smooth.framer,
  EASE: MOTION_PRESETS.gentle.framer,
};

/**
 * Physics-driven alternative to the timed ladder — deliberately NOT a member of
 * `MOTION_TIMING`, because it has no duration and so belongs to no rung.
 *
 * The numbers live in `MOTION.spring.snappy`, not here: this was one of two
 * byte-identical declarations of 300/25 (the other in `useMotion`), with
 * nothing saying they were meant to be the same spring.
 */
export const MOTION_SPRING = { type: 'spring' as const, ...MOTION.spring.snappy };

/** Stagger container -- wrap the list/grid parent with this variant. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

/** Individual item -- each card/row uses this variant. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { ...MOTION_PRESETS.smooth.framer, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: MOTION_PRESETS.snappy.framer,
  },
};

// ---------------------------------------------------------------------------
// Dashboard stagger variants
// 50ms stagger, `smooth` (250ms) ease-out entrance, translate-y-2 (8px) slide-up
//
// The entrance used to inline `duration: 0.3`, which is not on the repo's
// ladder (150 / 250 / 400ms) — a fourth duration invented at the call site,
// and the literal preset-vocabulary violation these presets exist to prevent.
// Both transitions now read from MOTION_PRESETS, so the ladder is the only
// place a dashboard duration can change.
// ---------------------------------------------------------------------------

/** Dashboard stagger container -- 50ms delay between children. */
export const dashboardContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

/** Dashboard stagger item -- fade+slide entrance on the `smooth` rung. */
export const dashboardItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: MOTION_PRESETS.smooth.framer,
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: MOTION_PRESETS.snappy.framer,
  },
};

export function useTemplateMotion() {
  const { shouldAnimate } = useMotion();

  return useMemo(() => {
    if (shouldAnimate) {
      return {
        prefersReducedMotion: false,
        motion: MOTION_PRESETS,
        staggerDelay: 0.04,
        staggerContainer,
        staggerItem,
      };
    }

    const reducedMotion = {
      snappy: {
        framer: REDUCED_FRAMER,
        css: CSS_DURATION_CLASS.snappy,
      },
      smooth: {
        framer: REDUCED_FRAMER,
        css: CSS_DURATION_CLASS.smooth,
      },
      gentle: {
        framer: REDUCED_FRAMER,
        css: CSS_DURATION_CLASS.gentle,
      },
    } as const;

    return {
      prefersReducedMotion: true,
      motion: reducedMotion,
      staggerDelay: 0,
      staggerContainer: {
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: {
            ...REDUCED_FRAMER,
            staggerChildren: 0,
          },
        },
      } as Variants,
      staggerItem: {
        hidden: { opacity: 0, y: 0 },
        show: {
          opacity: 1,
          y: 0,
          transition: REDUCED_FRAMER,
        },
        exit: {
          opacity: 0,
          y: 0,
          transition: REDUCED_FRAMER,
        },
      } as Variants,
    };
  }, [shouldAnimate]);
}
