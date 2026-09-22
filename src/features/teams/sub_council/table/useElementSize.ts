// The size of one element, as React state.
//
// The round table has a FIXED FRAME to fit - header, rose, reading, gate -
// and two of those decisions cannot be made in CSS: how big to draw the rose
// (an SVG needs a number, and it must shrink so the why-line and the
// coverage ring still clear the fold) and whether the header's two cards
// have room at all. Both are decisions about the STAGE's size, not the
// window's: the same window gives this table a different height depending on
// whether the app header, the galaxy HUD or the drawer is in front of it, so
// a `vh` breakpoint answers the wrong question.
import { useEffect, useState, type RefObject } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        // Rounded, and only when it actually moved: an unrounded rect from a
        // transformed ancestor jitters by fractions and would re-render the
        // whole table on every frame of the drawer's own slide.
        Math.round(r.width) === prev.width && Math.round(r.height) === prev.height
          ? prev
          : { width: Math.round(r.width), height: Math.round(r.height) },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
