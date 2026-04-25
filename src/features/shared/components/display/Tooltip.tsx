import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
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

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = MOTION.delay.tooltip,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [, setResolvedPlacement] = useState<Placement>(placement);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setPos(clampToViewport(raw, tooltipRect));
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
        className="contents"
      >
        {children}
      </span>
      {createPortal(
        <>
          {visible && (
            <div
              ref={tooltipRef}
              role="tooltip"
              className="animate-fade-slide-in fixed z-[9999] pointer-events-none max-w-[480px] text-md font-normal text-foreground glass-sm rounded-lg px-2.5 py-1.5 shadow-elevation-3"
              style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' as const, top: 0, left: 0 }}
            >
              {content}
            </div>
          )}
        </>,
        document.body,
      )}
    </>
  );
}
