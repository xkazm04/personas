// What the strip's hairline and the panel's revisions chart share (PORTED from bp timeline/shared.ts useScrub and the
// sliders' onKeyDown): the pointer drag that travels in time, the keys, the aria the slider announces, and the measured
// size. A drag or a key sets `ui.asOf` (null at now); BACK TO NOW and Esc clear it through the sheet's own ladder.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { revAt } from '../../engine/travel';
import { asOfFor, canTravel, dateAt, sliderKey, type ScrubGeom } from './scrub';
import { fmtDay } from './dates';

/** An element's client size, kept current by a ResizeObserver (`w0`/`h0` until it has one). */
export function useSize(ref: RefObject<HTMLElement | null>, w0: number, h0: number): [number, number] {
  const [s, setS] = useState<[number, number]>([w0, h0]);
  useEffect(() => {
    const n = ref.current;
    if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const r = n.getBoundingClientRect(); if (r.width && r.height) setS([Math.round(r.width), Math.round(r.height)]); });
    ro.observe(n);
    return () => ro.disconnect();
  }, [ref]);
  return s;
}

/** The time position the sliders show: the travelled date, else now. */
export function useTime() {
  const s = useSheet(), S = s.plan.S, t = s.ui.asOf ?? S.asOf, now = s.ui.asOf === null;
  return { t, now, weeks: S.weeks, asOf: S.asOf, rev: revAt(S.weeks, t), total: Math.max(1, S.weeks.length) };
}

/** The pointer and key handlers and the aria of one time slider over geometry `g` in svg units of width `W`. */
export function useSlider(svg: RefObject<SVGSVGElement | null>, W: number, g: ScrubGeom) {
  const s = useSheet(), { B, tx, language } = s.text, { t, now, rev, total, weeks } = useTime();
  const live = useRef({ g, W, asOf: g.asOf }), drag = useRef(false);
  useLayoutEffect(() => { live.current = { g, W, asOf: g.asOf }; });
  const go = (d: string) => s.dispatch({ type: 'asOf', date: asOfFor(live.current.asOf, d) });
  const at = (e: PointerEvent) => {
    const el = svg.current; if (!el) return;
    const r = el.getBoundingClientRect(), x = r.width > 0 ? ((e.clientX - r.left) / r.width) * live.current.W : 0;
    go(dateAt(live.current.g, x));
  };
  const still = !canTravel(weeks);
  let value = now ? tx(B.tl_value_now, { n: rev }) : tx(B.tl_value_past, { n: rev, date: fmtDay(language, t) });
  if (still) value += '; ' + B.tl_value_still;
  return {
    still,
    props: {
      role: 'slider', tabIndex: 0, 'aria-valuemin': 1, 'aria-valuemax': total, 'aria-valuenow': rev, 'aria-valuetext': value,
      'aria-disabled': still || undefined, 'data-still': still ? '' : undefined,
      onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
        e.stopPropagation();
        if (still) return;
        drag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); at(e);
      },
      onPointerMove: (e: PointerEvent<SVGSVGElement>) => { if (drag.current) at(e); },
      onPointerUp: () => { drag.current = false; },
      onPointerCancel: () => { drag.current = false; },
      onLostPointerCapture: () => { drag.current = false; },
      onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const d = sliderKey(e.key, live.current.g, t);
        if (d === undefined) return;
        // the slider's key: it never reaches the sheet's keymap (arrows walk the queue there, Enter descends)
        e.preventDefault(); e.stopPropagation();
        if (d !== t) go(d);
      },
    },
  };
}
