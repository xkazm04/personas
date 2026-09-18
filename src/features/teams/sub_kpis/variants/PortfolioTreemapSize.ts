// Container width for the treemap's inline <svg>. Recharts' ResponsiveContainer
// is not in play here (the treemap is hand-drawn SVG), so the width comes from
// a ResizeObserver on the wrapper. Width only: the height is fixed at
// TREEMAP_HEIGHT so the ghost and the chart occupy the same box and the
// ghost→content swap never jumps the page.
import { useEffect, useState, type RefObject } from 'react';

/** Fixed drawing height, shared by the treemap and its ghost. */
export const TREEMAP_HEIGHT = 420;

/** Sensible first-paint width so SSR/jsdom and the frame before the observer
 *  fires still lay out something proportional rather than nothing. */
const FALLBACK_WIDTH = 720;

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width));
    read();
    // Both, with ONE cleanup: the observer is the precise signal, the window
    // listener is the fallback where ResizeObserver is absent (older jsdom).
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      ro?.disconnect();
    };
  }, [ref]);

  return width > 0 ? width : FALLBACK_WIDTH;
}
