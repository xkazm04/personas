import { useRef, type ReactNode } from 'react';

interface CollapseProps {
  open: boolean;
  className?: string;
  children: ReactNode;
  duration?: number;
}

/**
 * Pure-CSS collapse/expand using the CSS grid row trick.
 * `grid-template-rows: 0fr → 1fr` with a transition gives smooth height animation
 * without measuring DOM height or using JS animation libraries.
 */
export function Collapse({ open, className, children, duration = 150 }: CollapseProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transition: `grid-template-rows ${duration}ms ease-out, opacity ${duration}ms ease-out`,
      }}
    >
      <div ref={innerRef} style={{ overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
