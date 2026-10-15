import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * The height left for a figure that has to fill its scroll area.
 *
 * The content area's body is a `min-h-full` block inside an `overflow-y-auto` box, so a percentage
 * height has nothing to resolve against. This finds that scroller, measures where the figure starts
 * inside its content (scroll-independent) and gives it everything below, with a floor so a short
 * window scrolls instead of crushing the dial. Re-measured by ResizeObserver, never per frame.
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, floor: number): number {
  const [h, setH] = useState(floor);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      if (!scroller) { setH(Math.max(floor, window.innerHeight - el.getBoundingClientRect().top)); return; }
      const offset = el.getBoundingClientRect().top + scroller.scrollTop - scroller.getBoundingClientRect().top;
      const next = Math.max(floor, Math.round(scroller.clientHeight - offset));
      setH((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller ?? document.documentElement);
    return () => ro.disconnect();
  }, [ref, floor]);
  return h;
}
