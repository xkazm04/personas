import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

export interface DropIndicatorProps {
  /**
   * Orientation of the list the indicator sits in. Vertical lists (the common
   * case) get a horizontal line between rows; horizontal lists get a vertical
   * bar between columns. Defaults to 'vertical'.
   */
  axis?: 'vertical' | 'horizontal';
  /**
   * Shared-layout id. Give every gap's indicator the SAME id within one list so
   * Framer animates a single line sliding between drop targets instead of
   * cross-fading separate lines. Defaults to 'drop-indicator'.
   */
  layoutId?: string;
  /** Inset the line from the container edges (e.g. past a leading drag handle). */
  inset?: string;
  className?: string;
}

/**
 * Animated drop-target line: a 2px primary bar with rounded caps that glides
 * between gaps via a shared `layoutId`. Render exactly one per list at the gap
 * the dragged item would land in; Framer's layout engine tweens it to each new
 * position as the pointer moves, removing the "where will this land?" guesswork.
 *
 * Under `prefers-reduced-motion` the layout tween is dropped so the line snaps
 * to its target gap instead of sliding.
 */
export function DropIndicator({
  axis = 'vertical',
  layoutId = 'drop-indicator',
  inset = '0px',
  className = '',
}: DropIndicatorProps) {
  const prefersReducedMotion = useReducedMotion();
  const isVertical = axis === 'vertical';

  return (
    <motion.div
      aria-hidden
      layoutId={layoutId}
      layout={prefersReducedMotion ? undefined : 'position'}
      initial={{ opacity: 0, scaleX: isVertical ? 0.6 : 1, scaleY: isVertical ? 1 : 0.6 }}
      animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={
        prefersReducedMotion
          ? { duration: 0.01 }
          : { type: 'spring', stiffness: 600, damping: 40 }
      }
      className={`pointer-events-none absolute z-10 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)] ${
        isVertical ? 'h-[2px] left-0 right-0' : 'w-[2px] top-0 bottom-0'
      } ${className}`}
      style={
        isVertical
          ? { left: inset, right: inset, transformOrigin: 'center' }
          : { top: inset, bottom: inset, transformOrigin: 'center' }
      }
    />
  );
}
