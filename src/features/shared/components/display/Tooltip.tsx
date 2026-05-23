import { useState, useRef, useCallback, useEffect, useId, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MOTION } from '@/lib/utils/designTokens';
type Placement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  /** The text to display in the tooltip */
  content: string;
  /** The element that triggers the tooltip on hover */
  children: ReactNode;
  /** Where to place the tooltip relative to the trigger */
  placement?: Placement;
  /** Hover delay in ms before showing the tooltip */
  delay?: number;
  /**
   * Make the trigger wrapper a focusable box (`tabIndex=0`, `aria-disabled`) instead of a
   * layout-transparent `display:contents` span. Use this when the wrapped child is an inert
   * control — a disabled `<button>` cannot receive focus or fire pointer events, so without a
   * focusable wrapper the tooltip would never surface on hover OR keyboard focus. The wrapped
   * control should set `pointer-events-none` so hover falls through to this box.
   */
  triggerFocusable?: boolean;
  /**
   * Extra classes for the trigger wrapper. Only meaningful when `triggerFocusable` is set
   * (the default `display:contents` wrapper has no box and ignores layout classes). Pass e.g.
   * `flex w-full` to keep a full-width disabled button laid out correctly.
   */
  triggerClassName?: string;
}

const OFFSET = 8;
const VIEWPORT_PAD = 6;

const FLIP_MAP: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function getPosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  placement: Placement,
): { top: number; left: number } {
  switch (placement) {
    case 'top':
      return {
        top: triggerRect.top - tooltipRect.height - OFFSET,
        left: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2,
      };
    case 'bottom':
      return {
        top: triggerRect.bottom + OFFSET,
        left: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2,
      };
    case 'left':
      return {
        top: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2,
        left: triggerRect.left - tooltipRect.width - OFFSET,
      };
    case 'right':
      return {
        top: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2,
        left: triggerRect.right + OFFSET,
      };
  }
}

/** Check whether the preferred placement overflows the viewport and flip if so. */
function resolvePlacement(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  preferred: Placement,
): Placement {
  const pos = getPosition(triggerRect, tooltipRect, preferred);

  const overflows =
    pos.top < VIEWPORT_PAD ||
    pos.left < VIEWPORT_PAD ||
    pos.top + tooltipRect.height > window.innerHeight - VIEWPORT_PAD ||
    pos.left + tooltipRect.width > window.innerWidth - VIEWPORT_PAD;

  if (!overflows) return preferred;

  // Check if the flipped side fits
  const flipped = FLIP_MAP[preferred];
  const flippedPos = getPosition(triggerRect, tooltipRect, flipped);
  const flippedOverflows =
    flippedPos.top < VIEWPORT_PAD ||
    flippedPos.left < VIEWPORT_PAD ||
    flippedPos.top + tooltipRect.height > window.innerHeight - VIEWPORT_PAD ||
    flippedPos.left + tooltipRect.width > window.innerWidth - VIEWPORT_PAD;

  return flippedOverflows ? preferred : flipped;
}

function clampToViewport(
  pos: { top: number; left: number },
  tooltipRect: DOMRect,
): { top: number; left: number } {
  return {
    top: Math.max(VIEWPORT_PAD, Math.min(pos.top, window.innerHeight - tooltipRect.height - VIEWPORT_PAD)),
    left: Math.max(VIEWPORT_PAD, Math.min(pos.left, window.innerWidth - tooltipRect.width - VIEWPORT_PAD)),
  };
}

// -- Arrow geometry ---------------------------------------------------------
// The arrow is an 8px CSS-border triangle that points from the tooltip box
// back toward its trigger. ARROW_HALF is half the base; ARROW_DEPTH is how far
// the tip protrudes from the box edge. The fill matches the `.glass-sm`
// surface (background mixed 70% with transparency) so the triangle reads as a
// seamless continuation of the box rather than a detached chevron.
const ARROW_HALF = 7;
const ARROW_DEPTH = 6;
const ARROW_FILL = 'color-mix(in srgb, var(--background) 70%, transparent)';
// Keep the arrow's center this far from the box corners so it never collides
// with the `rounded-lg` (8px) radius even after the box is clamped to the
// viewport edge.
const ARROW_EDGE_INSET = 14;

/**
 * Position the arrow on the box edge that faces the trigger, offset along the
 * cross-axis so its tip tracks the trigger's center (clamped to stay clear of
 * the rounded corners). `offset` is the trigger-center coordinate expressed in
 * the box's own coordinate space (px from its left for top/bottom placements,
 * px from its top for left/right).
 */
function getArrowStyle(placement: Placement, offset: number): CSSProperties {
  const base: CSSProperties = { position: 'absolute', width: 0, height: 0 };
  const transparentH = `${ARROW_HALF}px solid transparent`;
  switch (placement) {
    case 'top': // box above trigger → arrow on bottom edge, pointing down
      return {
        ...base,
        top: '100%',
        left: offset,
        transform: 'translateX(-50%)',
        borderLeft: transparentH,
        borderRight: transparentH,
        borderTop: `${ARROW_DEPTH}px solid ${ARROW_FILL}`,
        filter: 'drop-shadow(0 1px 0.5px var(--glass-border))',
      };
    case 'bottom': // box below trigger → arrow on top edge, pointing up
      return {
        ...base,
        bottom: '100%',
        left: offset,
        transform: 'translateX(-50%)',
        borderLeft: transparentH,
        borderRight: transparentH,
        borderBottom: `${ARROW_DEPTH}px solid ${ARROW_FILL}`,
        filter: 'drop-shadow(0 -1px 0.5px var(--glass-border))',
      };
    case 'left': // box left of trigger → arrow on right edge, pointing right
      return {
        ...base,
        left: '100%',
        top: offset,
        transform: 'translateY(-50%)',
        borderTop: transparentH,
        borderBottom: transparentH,
        borderLeft: `${ARROW_DEPTH}px solid ${ARROW_FILL}`,
        filter: 'drop-shadow(1px 0 0.5px var(--glass-border))',
      };
    case 'right': // box right of trigger → arrow on left edge, pointing left
      return {
        ...base,
        right: '100%',
        top: offset,
        transform: 'translateY(-50%)',
        borderTop: transparentH,
        borderBottom: transparentH,
        borderRight: `${ARROW_DEPTH}px solid ${ARROW_FILL}`,
        filter: 'drop-shadow(-1px 0 0.5px var(--glass-border))',
      };
  }
}

/** Trigger-center offset along the box's cross-axis, clamped clear of corners. */
function computeArrowOffset(
  triggerRect: DOMRect,
  finalPos: { top: number; left: number },
  tooltipRect: DOMRect,
  placement: Placement,
): number {
  if (placement === 'top' || placement === 'bottom') {
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const raw = triggerCenterX - finalPos.left;
    return Math.max(ARROW_EDGE_INSET, Math.min(raw, tooltipRect.width - ARROW_EDGE_INSET));
  }
  const triggerCenterY = triggerRect.top + triggerRect.height / 2;
  const raw = triggerCenterY - finalPos.top;
  return Math.max(ARROW_EDGE_INSET, Math.min(raw, tooltipRect.height - ARROW_EDGE_INSET));
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = MOTION.delay.tooltip.default,
  triggerFocusable = false,
  triggerClassName,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [resolvedPlacement, setResolvedPlacement] = useState<Placement>(placement);
  const [arrowOffset, setArrowOffset] = useState<number | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable id so the trigger can reference the tooltip via aria-describedby —
  // screen readers and pointer hover then share one accessible source.
  const tooltipId = useId();

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  // Position the tooltip after it becomes visible and renders
  useEffect(() => {
    if (!visible) {
      setPos(null);
      setArrowOffset(null);
      setResolvedPlacement(placement);
      return;
    }

    // Use rAF to wait for the tooltip DOM node to be painted
    const rafId = requestAnimationFrame(() => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();

      const resolved = resolvePlacement(triggerRect, tooltipRect, placement);
      setResolvedPlacement(resolved);

      const raw = getPosition(triggerRect, tooltipRect, resolved);
      const finalPos = clampToViewport(raw, tooltipRect);
      setPos(finalPos);
      setArrowOffset(computeArrowOffset(triggerRect, finalPos, tooltipRect, resolved));
    });

    return () => cancelAnimationFrame(rafId);
  }, [visible, placement]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!content) return <>{children}</>;

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // A disabled control can't take focus itself; when triggerFocusable is set the wrapper
        // becomes the focus target (tabIndex 0) and announces the wrapped control's inert state
        // (aria-disabled) so the reason surfaces for keyboard + screen-reader users. Escape
        // dismisses an open tooltip without moving focus.
        tabIndex={triggerFocusable ? 0 : undefined}
        aria-disabled={triggerFocusable || undefined}
        aria-describedby={visible ? tooltipId : undefined}
        onKeyDown={triggerFocusable ? (e) => { if (e.key === 'Escape') hide(); } : undefined}
        className={triggerFocusable ? (triggerClassName ?? 'inline-flex') : 'contents'}
      >
        {children}
      </span>
      {createPortal(
        <>
          {visible && (
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className="animate-fade-slide-in fixed z-[9999] pointer-events-none max-w-[480px] text-md font-normal text-foreground glass-sm rounded-lg px-2.5 py-1.5 shadow-elevation-3"
              style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' as const, top: 0, left: 0 }}
            >
              {content}
              {pos && arrowOffset !== null && (
                <span aria-hidden="true" style={getArrowStyle(resolvedPlacement, arrowOffset)} />
              )}
            </div>
          )}
        </>,
        document.body,
      )}
    </>
  );
}
