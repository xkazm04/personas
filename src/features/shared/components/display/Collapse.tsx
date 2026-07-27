import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

interface CollapseProps {
  open: boolean;
  className?: string;
  children: ReactNode;
  duration?: number;
  /**
   * Unmount `children` once the close transition finishes, and mount them again
   * the moment it reopens.
   *
   * Off by default so the original callers keep their always-mounted behaviour.
   * Turn it ON when migrating an `<AnimatePresence>{open && …}</AnimatePresence>`
   * collapse: that pattern unmounts its subtree, and silently dropping the
   * unmount would leave effects, subscriptions and polling alive inside every
   * closed section.
   */
  unmountWhenClosed?: boolean;
  /**
   * Switch the inner wrapper to `overflow: visible` once the open transition
   * finishes, so a dropdown/popover rendered inside is not clipped. Stays
   * `hidden` while animating and whenever closed, so content cannot spill out
   * mid-transition.
   */
  revealOverflowWhenOpen?: boolean;
}

/**
 * @catalog Pure-CSS animated expand/collapse container.
 *
 * Uses the CSS grid row trick: `grid-template-rows: 0fr → 1fr` with a
 * transition gives a smooth height animation without measuring the DOM and
 * without animating `height`, which forces a layout pass on every frame.
 *
 * `<MotionConfig reducedMotion="user">` only gates framer-motion, not CSS
 * transitions, so this component reads `prefers-reduced-motion` itself and
 * collapses the duration to zero.
 */
export function Collapse({
  open,
  className,
  children,
  duration = 150,
  unmountWhenClosed = false,
  revealOverflowWhenOpen = false,
}: CollapseProps) {
  const reduceMotion = useReducedMotion();
  const effectiveDuration = reduceMotion ? 0 : duration;

  // Children stay mounted through the close transition and only then go away —
  // unmounting immediately would empty the box before it finished shrinking.
  const [render, setRender] = useState(open || !unmountWhenClosed);
  // True only once the open transition has settled; never while animating.
  const [settledOpen, setSettledOpen] = useState(open && revealOverflowWhenOpen);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];

    if (open) {
      setRender(true);
      if (revealOverflowWhenOpen) {
        timers.current.push(setTimeout(() => setSettledOpen(true), effectiveDuration));
      }
    } else {
      setSettledOpen(false);
      if (unmountWhenClosed) {
        timers.current.push(setTimeout(() => setRender(false), effectiveDuration));
      }
    }

    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, [open, effectiveDuration, unmountWhenClosed, revealOverflowWhenOpen]);

  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transition: `grid-template-rows ${effectiveDuration}ms ease-out, opacity ${effectiveDuration}ms ease-out`,
      }}
    >
      <div style={{ overflow: revealOverflowWhenOpen && settledOpen && open ? 'visible' : 'hidden' }}>
        {render ? children : null}
      </div>
    </div>
  );
}
