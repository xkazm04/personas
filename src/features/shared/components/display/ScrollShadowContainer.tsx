import { useRef, type ReactNode, type RefObject } from 'react';
import { useScrollShadow } from '@/hooks/utility/interaction/useScrollShadow';

interface ScrollShadowContainerProps {
  children: ReactNode;
  /** Classes applied to the inner scrollable div (e.g. "overflow-y-auto p-4"). */
  className?: string;
  /** Optional external ref for the scrollable element. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** CSS color for the gradient. Defaults to the theme background. */
  shadowColor?: string;
  /** Height of the shadow gradient in px. Default 24. */
  shadowHeight?: number;
  /** Extra classes on the outer wrapper (participates in flex layout). */
  wrapperClassName?: string;
}

/**
 * Wraps a scrollable container and overlays 24px gradient shadows at
 * the top/bottom edges when content overflows in that direction.
 *
 * The outer wrapper takes on flex-1 + min-h-0 so it slots into flex
 * layouts transparently. The inner div becomes the scroll container.
 */
export function ScrollShadowContainer({
  children,
  className = '',
  scrollRef: externalRef,
  shadowColor,
  shadowHeight = 24,
  wrapperClassName,
}: ScrollShadowContainerProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const ref = externalRef ?? internalRef;
  const { canScrollUp, canScrollDown } = useScrollShadow(ref);

  const color = shadowColor ?? 'var(--background)';

  return (
    <div className={wrapperClassName ?? 'relative flex-1 min-h-0'}>
      <div ref={ref} className={`h-full ${className}`}>
        {children}
      </div>
      <div
        className={`absolute top-0 inset-x-0 pointer-events-none z-[1] transition-opacity duration-200 ${canScrollUp ? 'opacity-100' : 'opacity-0'}`}
        style={{
          height: shadowHeight,
          background: `linear-gradient(to bottom, ${color}, transparent)`,
        }}
      />
      <div
        className={`absolute bottom-0 inset-x-0 pointer-events-none z-[1] transition-opacity duration-200 ${canScrollDown ? 'opacity-100' : 'opacity-0'}`}
        style={{
          height: shadowHeight,
          background: `linear-gradient(to top, ${color}, transparent)`,
        }}
      />
    </div>
  );
}
