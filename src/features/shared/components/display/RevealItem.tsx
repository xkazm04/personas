import { forwardRef, useEffect, type AnimationEvent, type HTMLAttributes } from 'react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

/**
 * @catalog RevealItem — plays a one-shot staggered fade-in for a single list/table row as it is progressively revealed; tracks entry by id so virtualized rows don't re-animate on scroll. Polymorphic via `as` ('div' | 'tr' | 'li') so it can wrap table/list rows directly (a `<div>` is invalid inside `<tbody>`/`<ul>`).
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

/**
 * Elements `RevealItem` can render as. `tr`/`li` exist because a wrapping
 * `<div>` is invalid inside `<tbody>` / `<ul>` — the entrance is then applied
 * to the row element itself. Default `div`.
 */
export type RevealItemTag = 'div' | 'tr' | 'li';

export interface RevealItemProps extends HTMLAttributes<HTMLElement> {
  /** Stable id for this row — drives the "already entered" guard. */
  revealId: string;
  /** Position within the current reveal wave (`index - reveal.newSince`). 0-based. */
  order?: number;
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
  /** Element to render — `div` (default), or `tr`/`li` for table/list rows
   *  where a wrapping `<div>` would be invalid HTML. */
  as?: RevealItemTag;
}

export const RevealItem = forwardRef<HTMLElement, RevealItemProps>(function RevealItem(
  { revealId, order = 0, hasEntered, markEntered, as = 'div', className, style, children, onAnimationEnd, ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  const animate = !reduced && !hasEntered(revealId);

  // Reduced motion: nothing animates, so record entry up front.
  useEffect(() => {
    if (reduced) markEntered(revealId);
  }, [reduced, revealId, markEntered]);

  const delay = animate ? Math.min(Math.max(0, order), MAX_STAGGER) * STEP_MS : 0;

  // Render the identical entrance mechanics as a <div>, <tr>, or <li> without
  // duplicating them at each callsite (a <div> can't legally wrap a <tr>/<li>).
  // `as` is a constrained intrinsic tag at runtime and every prop below is a
  // valid HTML/ref attribute; the cast only sidesteps JSX's intrinsic-union
  // collapsing the element's prop type to `never`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Tag = as as any;
  return (
    <Tag
      ref={ref}
      className={animate ? `${className ?? ''} animate-fade-in`.trim() : className}
      style={animate ? { ...style, animationDelay: `${delay}ms` } : style}
      onAnimationEnd={(e: AnimationEvent<HTMLElement>) => {
        // Only our own fade — ignore CSS animations bubbling up from children.
        if (e.target === e.currentTarget) markEntered(revealId);
        onAnimationEnd?.(e);
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
});
