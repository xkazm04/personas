/** Layout size of an element (ResizeObserver's contentRect, so the camera's
 *  scale and the page turn's slide never leak into the drawing's geometry). */
import { useLayoutEffect, useState, type RefObject } from "react";

export function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** An element's box relative to `root`, by the offset chain: layout
 *  coordinates, untouched by any transform the camera has applied. */
export function offsetRect(el: HTMLElement | null | undefined, root: HTMLElement | null): { x: number; y: number; w: number; h: number } | null {
  if (!el || !root) return null;
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return n === root ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
}
