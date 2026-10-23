import { useRef, useState, useCallback, useLayoutEffect, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { MOTION } from '@/lib/utils/designTokens';

interface TruncateWithTooltipProps {
  text: string;
  className?: string;
  as?: 'span' | 'div' | 'p';
  children?: ReactNode;
}

/**
 * Renders text with CSS truncation and shows a tooltip with the full text
 * only when the content is actually overflowing. Works on both hover (400ms
 * delay) and keyboard focus; truncated text is a tab stop, untruncated is not.
 */
export function TruncateWithTooltip({
  text,
  className = '',
  as: Tag = 'span',
  children,
}: TruncateWithTooltipProps) {
  const ref = useRef<HTMLElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = ref.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, []);

  // Decide BEFORE the user arrives. Measuring only on mouseenter/focus meant
  // the first hover flipped `isTruncated`, which re-parents the element under
  // <Tooltip> and REMOUNTS it: the hover that asked for the tip landed on the
  // discarded node (no tooltip until the pointer left and came back) and a
  // keyboard focus was dropped to <body>. Measure at layout time and whenever
  // the box resizes; the event handlers below stay as a cheap re-check.
  useLayoutEffect(() => {
    checkOverflow();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkOverflow, text, children]);

  const inner = (
    <Tag
      ref={ref as React.RefObject<HTMLElement & HTMLSpanElement & HTMLDivElement & HTMLParagraphElement>}
      className={`truncate ${className}`}
      onMouseEnter={checkOverflow}
      onFocus={checkOverflow}
      // A tab stop only when there is something hidden to reveal; untruncated
      // text was a dead stop on every row that renders one of these.
      tabIndex={isTruncated ? 0 : undefined}
    >
      {children ?? text}
    </Tag>
  );

  if (!isTruncated) return inner;

  return (
    <Tooltip content={text} delay={MOTION.delay.tooltip.default}>
      {inner}
    </Tooltip>
  );
}
