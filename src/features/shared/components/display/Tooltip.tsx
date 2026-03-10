import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

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

function clampToViewport(
  pos: { top: number; left: number },
  tooltipRect: DOMRect,
): { top: number; left: number } {
  const pad = 6;
  return {
    top: Math.max(pad, Math.min(pos.top, window.innerHeight - tooltipRect.height - pad)),
    left: Math.max(pad, Math.min(pos.left, window.innerWidth - tooltipRect.width - pad)),
  };
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 400,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
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
      return;
    }

    // Use rAF to wait for the tooltip DOM node to be painted
    const rafId = requestAnimationFrame(() => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();

      const raw = getPosition(triggerRect, tooltipRect, placement);
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
        <AnimatePresence>
          {visible && (
            <motion.div
              ref={tooltipRef}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              role="tooltip"
              className="fixed z-[9999] pointer-events-none max-w-[240px] text-xs text-foreground bg-background/95 backdrop-blur-sm border border-primary/15 rounded-lg px-2.5 py-1.5 shadow-lg"
              style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' as const, top: 0, left: 0 }}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
