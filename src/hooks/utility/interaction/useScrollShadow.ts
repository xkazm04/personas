import { useState, useEffect, useCallback, type RefObject } from 'react';

/**
 * Tracks scroll position of a container and reports whether content
 * overflows above and/or below the visible area.
 *
 * Attach the returned ref (or pass your own) to the scrollable element.
 * The booleans update on scroll and resize via passive listeners + ResizeObserver.
 */
export function useScrollShadow(scrollRef: RefObject<HTMLElement | null>) {
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 1);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Initial check
    update();

    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);

    // MutationObserver removed: it caused an infinite loop.
    // React render → DOM mutation → MutationObserver → setState → re-render → DOM mutation → ...
    // ResizeObserver is sufficient to detect content height changes.

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [scrollRef, update]);

  return { canScrollUp, canScrollDown };
}
