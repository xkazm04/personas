// Tell the engine where the chrome is.
//
// The reading-order card and the counts panel are opaque HTML sitting over
// the canvas. Until the occupancy pass knows their boxes it will happily lay
// a cluster caption underneath one, and the label is not hidden by density,
// it is hidden by furniture. One ResizeObserver over both cards, measured
// relative to the stage, re-fed whenever either changes size or the stage
// does.
import { useEffect, type RefObject } from 'react';

import type { GalaxyEngine } from './engine/GalaxyEngine';

export function useHudReservations(
  stageRef: RefObject<HTMLElement | null>,
  cardRefs: Array<RefObject<HTMLElement | null>>,
  engine: GalaxyEngine | null,
  /** False while the cards are unmounted: nothing is reserved, and the
   *  occupancy pass gets the whole stage back. */
  enabled = true,
): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (!engine || !stage) return;
    if (!enabled) {
      engine.setReservedRects([]);
      return;
    }

    const measure = () => {
      const base = stage.getBoundingClientRect();
      engine.setReservedRects(
        cardRefs
          .map((ref) => ref.current)
          .filter((el): el is HTMLElement => Boolean(el))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height };
          }),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    for (const ref of cardRefs) {
      if (ref.current) observer.observe(ref.current);
    }
    return () => observer.disconnect();
    // `cardRefs` is a stable array of stable refs owned by the caller; the
    // cards themselves are re-measured by the observer, not by a re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, engine, stageRef]);
}
