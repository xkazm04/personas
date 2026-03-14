import { useMemo, type ReactNode, type HTMLAttributes } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

const EASE_CURVE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** Max items that receive a stagger delay. Items beyond this cap animate instantly. */
const DEFAULT_STAGGER_CAP = 10;

/** Default item entrance variants (opacity 0→1, y 8→0, 150ms). */
const defaultItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.15, ease: EASE_CURVE },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.1, ease: EASE_CURVE },
  },
};

const reducedItemVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } },
};

interface AnimatedListProps extends Pick<HTMLAttributes<HTMLElement>, 'role' | 'aria-label' | 'id'> {
  /** Rendered children — each direct child becomes an animated item. */
  children: ReactNode[];
  /** Stagger delay per item in seconds (default 0.04 = 40ms). */
  staggerDelay?: number;
  /** Max items that receive incremental stagger (default 10). */
  staggerCap?: number;
  /** Custom item variants. Falls back to default fade+slide. */
  itemVariants?: Variants;
  /** CSS class for the container wrapper. */
  className?: string;
  /** HTML tag for the container (default "div"). */
  as?: 'div' | 'ul' | 'ol';
  /** HTML tag for each item wrapper (default "div", use "li" with ul/ol). */
  itemAs?: 'div' | 'li';
  /** Unique keys for each child. Must match children length. */
  keys?: string[];
  /** Whether to animate items exiting (default false). */
  animateExit?: boolean;
}

/**
 * Reusable staggered-entrance wrapper for lists and grids.
 *
 * Wraps each child in a `motion.div` (or `motion.li`) with a cascading
 * opacity + translateY entrance animation. Stagger delay is capped at
 * `staggerCap` items to avoid slow-feeling renders on large lists.
 *
 * Respects `prefers-reduced-motion` via `useMotion()`.
 */
export function AnimatedList({
  children,
  staggerDelay = 0.04,
  staggerCap = DEFAULT_STAGGER_CAP,
  itemVariants,
  className,
  as: Container = 'div',
  itemAs: ItemTag = 'div',
  keys,
  animateExit = false,
  ...containerProps
}: AnimatedListProps) {
  const { shouldAnimate } = useMotion();

  const effectiveDelay = shouldAnimate ? staggerDelay : 0;
  const variants = shouldAnimate ? (itemVariants ?? defaultItemVariants) : reducedItemVariants;

  const containerVariants = useMemo<Variants>(
    () => ({
      hidden: {},
      show: {
        transition: {
          staggerChildren: effectiveDelay,
        },
      },
    }),
    [effectiveDelay],
  );

  const MotionContainer = motion.create(Container);
  const MotionItem = motion.create(ItemTag);

  const items = Array.isArray(children) ? children : [children];

  const content = items.map((child, i) => {
    // Items beyond the stagger cap skip the incremental delay
    const itemTransition =
      i >= staggerCap
        ? { ...((variants.show as Record<string, unknown>)?.transition as object ?? {}), delay: 0 }
        : undefined;

    const key = keys?.[i] ?? i;

    return (
      <MotionItem
        key={key}
        variants={variants}
        {...(itemTransition ? { transition: itemTransition } : {})}
      >
        {child}
      </MotionItem>
    );
  });

  return (
    <MotionContainer
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="show"
      {...containerProps}
      {...(animateExit ? { exit: 'hidden' } : {})}
    >
      {animateExit ? <AnimatePresence>{content}</AnimatePresence> : content}
    </MotionContainer>
  );
}
