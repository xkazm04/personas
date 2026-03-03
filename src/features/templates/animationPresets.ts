import { useMemo } from 'react';
import { useReducedMotion, type Variants } from 'framer-motion';

export const CSS_DURATION_CLASS = {
  snappy: 'duration-snap motion-reduce:duration-0 motion-reduce:transition-none',
  smooth: 'duration-flow motion-reduce:duration-0 motion-reduce:transition-none',
  gentle: 'duration-ease motion-reduce:duration-0 motion-reduce:transition-none',
  SNAP: 'duration-snap motion-reduce:duration-0 motion-reduce:transition-none',
  FLOW: 'duration-flow motion-reduce:duration-0 motion-reduce:transition-none',
  EASE: 'duration-ease motion-reduce:duration-0 motion-reduce:transition-none',
} as const;

const REDUCED_FRAMER = { duration: 0.01, ease: 'linear' as const };

export const MOTION = {
  snappy: {
    framer: { duration: 0.15, ease: 'easeOut' as const },
    css: CSS_DURATION_CLASS.snappy,
  },
  smooth: {
    framer: { duration: 0.25, ease: 'easeOut' as const },
    css: CSS_DURATION_CLASS.smooth,
  },
  gentle: {
    framer: { duration: 0.4, ease: 'easeOut' as const },
    css: CSS_DURATION_CLASS.gentle,
  },
} as const;

export const MOTION_TIMING = {
  SNAP: MOTION.snappy.framer,
  FLOW: MOTION.smooth.framer,
  EASE: { type: 'spring' as const, stiffness: 300, damping: 25 },
};

/** Stagger container — wrap the list/grid parent with this variant. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

/** Individual item — each card/row uses this variant. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { ...MOTION.smooth.framer, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: MOTION.snappy.framer,
  },
};

export function useTemplateMotion() {
  const prefersReducedMotion = useReducedMotion();

  return useMemo(() => {
    if (!prefersReducedMotion) {
      return {
        prefersReducedMotion,
        motion: MOTION,
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
      prefersReducedMotion,
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
  }, [prefersReducedMotion]);
}
