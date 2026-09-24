/**
 * Screen centring for the frame's centre column. The left rail and the right
 * panel differ in width, so the centre column's own middle sits left of the
 * screen's middle. A piece narrower than the column is shifted toward the
 * screen's middle (owner, 2026-09-24: "ignore the right panel, centre both on
 * x independently"), never further than its slack inside the column, so it
 * cannot slide under a rail.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Marks a frame piece for `useScreenCentre` to measure. */
export const FRAME_EDGE_ATTR = 'data-frame-edge';

/** The x shift that puts a `pieceW`-wide piece, centred in `col`, on `screenMid`. */
export function centreShift(screenMid: number, col: { left: number; width: number }, pieceW: number): number {
  const slack = Math.max(0, (col.width - pieceW) / 2);
  const want = screenMid - (col.left + col.width / 2);
  return Math.round(Math.max(-slack, Math.min(slack, want)));
}

/** Per-edge x shifts for the pieces inside `column`, centred on `layer`. */
export function useScreenCentre<E extends string>(
  layer: RefObject<HTMLElement | null>,
  column: RefObject<HTMLElement | null>,
  edges: readonly E[],
): Partial<Record<E, number>> {
  const [shifts, setShifts] = useState<Partial<Record<E, number>>>({});
  const edgesRef = useRef(edges);
  useLayoutEffect(() => {
    const l = layer.current;
    const c = column.current;
    if (!l || !c) return;
    const measure = () => {
      const lr = l.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const mid = lr.left + lr.width / 2;
      const next: Partial<Record<E, number>> = {};
      for (const e of edgesRef.current) {
        const piece = c.querySelector<HTMLElement>(`[${FRAME_EDGE_ATTR}="${e}"]`);
        // offsetWidth ignores the CSS translate, so the measure never feeds itself.
        if (piece) next[e] = centreShift(mid, cr, piece.offsetWidth);
      }
      setShifts((prev) => (edgesRef.current.every((e) => prev[e] === next[e]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(l);
    ro.observe(c);
    return () => ro.disconnect();
  }, [layer, column]);
  return shifts;
}
