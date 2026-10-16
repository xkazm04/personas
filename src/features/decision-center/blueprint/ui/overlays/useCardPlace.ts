// Keeps a card beside a feature on the plan as the camera moves (PORTED from bp Overlays.tsx DecisionCard's `place`):
// to the right of the feature's screen rect, else to its left, clamped into the safe area (never under the rail or the
// title block). It runs on every drawn frame, outside React, and writes the transform straight to the element; the
// card's height comes from a ResizeObserver, never from a read per frame.
import { useEffect, useRef, type RefObject } from 'react';
import type { Engine } from '../../engine/Engine';
import type { ViewStore } from '../../state/viewStore';

/** Where a w x h card stands beside rect `r` inside the safe area `S` (pure, for the tests). */
export function placeBeside(r: { x: number; y: number; w: number; h: number }, S: { l: number; t: number; r: number; b: number }, w: number, h: number): { x: number; y: number } {
  let x = r.x + r.w + 16, y = r.y + r.h / 2 - h / 2;
  if (x + w > S.r) x = r.x - w - 16;
  if (x < S.l) x = Math.max(S.l, S.r - w - 8);
  y = Math.max(S.t, Math.min(Math.max(S.t, S.b - h), y));
  return { x, y };
}

export function useCardPlace(el: RefObject<HTMLElement | null>, engine: Engine | null, view: ViewStore, fid: string | null, w: number): void {
  const hgt = useRef(0);
  useEffect(() => {
    if (!engine || !fid) return;
    const place = () => {
      const n = el.current; if (!n) return;
      const r = engine.featRect(fid, engine.cam.lod());
      if (!r) { n.style.visibility = 'hidden'; return; }
      const p = placeBeside(r, engine.cam.SAFE, w, hgt.current || 380);
      n.style.visibility = ''; n.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => { const h = es[0]?.contentRect.height || 0; if (h !== hgt.current) { hgt.current = h; place(); } }) : null;
    if (el.current) ro?.observe(el.current);
    const first = requestAnimationFrame(place);
    const off = view.onFrame(place);
    return () => { cancelAnimationFrame(first); off(); ro?.disconnect(); };
  }, [el, engine, view, fid, w]);
}
