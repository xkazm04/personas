/**
 * The LAYOUT size of one element (clientWidth/clientHeight), as React state.
 * Unlike `useElementSize` (getBoundingClientRect), a transformed ancestor or
 * the element's own zoom/scale entrance does not distort it, which matters
 * here because the ring zooms and the page may slide in under it.
 * (Could be shared beside useElementSize.)
 *
 * Before the first measurement (and in jsdom, which lays nothing out) it
 * returns `fallback` with `measured: false`.
 */
import { useEffect, useState, type RefObject } from 'react';

export interface CanvasSize {
  w: number;
  h: number;
  measured: boolean;
}

export function useCanvasSize(ref: RefObject<HTMLElement | null>, fallback: { w: number; h: number }): CanvasSize {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  const measured = size.w > 0 && size.h > 0;
  return measured ? { ...size, measured } : { ...fallback, measured };
}
