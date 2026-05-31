import { forwardRef, useEffect, type ComponentPropsWithoutRef } from 'react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

/**
 * @catalog RevealItem — plays a one-shot staggered fade-in for a single list/table row as it is progressively revealed; tracks entry by id so virtualized rows don't re-animate on scroll.
 *
 * Pair with `useProgressiveReveal` (for `order`/`newSince`) and
 * `useRevealTracker` (for the `hasEntered`/`markEntered` per-id guard):
 *
 * ```tsx
 * const reveal = useProgressiveReveal(rows.length, { resetKey });
 * const enter = useRevealTracker(resetKey);
 * // inside the virtual/list map, for item at `index`:
 * <RevealItem revealId={row.id} order={index - reveal.newSince} {...enter} style={posStyle} className="row">
 *   …cells…
 * </RevealItem>
 * ```
 *
 * Entry is marked on `animationend` (not mount) so the fade is never cut short
 * by an interleaved re-render; once entered, the row renders plainly so
 * scrolling a virtualized list never replays the animation. Honors
 * `prefers-reduced-motion` (no animation, marked entered immediately).
 */

/** Per-item stagger step (ms) and the cap on how many items stagger within one wave. */
const STEP_MS = 35;
const MAX_STAGGER = 8;

export interface RevealItemProps extends ComponentPropsWithoutRef<'div'> {
  /** Stable id for this row — drives the "already entered" guard. */
  revealId: string;
  /** Position within the current reveal wave (`index - reveal.newSince`). 0-based. */
  order?: number;
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
}

export const RevealItem = forwardRef<HTMLDivElement, RevealItemProps>(function RevealItem(
  { revealId, order = 0, hasEntered, markEntered, className, style, children, onAnimationEnd, ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  const animate = !reduced && !hasEntered(revealId);

  // Reduced motion: nothing animates, so record entry up front.
  useEffect(() => {
    if (reduced) markEntered(revealId);
  }, [reduced, revealId, markEntered]);

  const delay = animate ? Math.min(Math.max(0, order), MAX_STAGGER) * STEP_MS : 0;

  return (
    <div
      ref={ref}
      className={animate ? `${className ?? ''} animate-fade-in` : className}
      style={animate ? { ...style, animationDelay: `${delay}ms` } : style}
      onAnimationEnd={(e) => {
        // Only our own fade — ignore CSS animations bubbling up from children.
        if (e.target === e.currentTarget) markEntered(revealId);
        onAnimationEnd?.(e);
      }}
      {...rest}
    >
      {children}
    </div>
  );
});
