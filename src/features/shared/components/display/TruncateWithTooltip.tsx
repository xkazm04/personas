import { useRef, useState, useCallback, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

interface TruncateWithTooltipProps {
  text: string;
  className?: string;
  as?: 'span' | 'div' | 'p';
  children?: ReactNode;
}

/**
 * Renders text with CSS truncation and shows a tooltip with the full text
 * only when the content is actually overflowing. Works on both hover (400ms
 * delay) and keyboard focus.
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

  const inner = (
    <Tag
      ref={ref as React.RefObject<HTMLElement & HTMLSpanElement & HTMLDivElement & HTMLParagraphElement>}
      className={`truncate ${className}`}
      onMouseEnter={checkOverflow}
      onFocus={checkOverflow}
      tabIndex={0}
    >
      {children ?? text}
    </Tag>
  );

  if (!isTruncated) return inner;

  return (
    <Tooltip content={text} delay={400}>
      {inner}
    </Tooltip>
  );
}
