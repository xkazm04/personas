// The spread dock's canvas: `spreadPaint.ts` driven by the engine's frames,
// so the rows rise with the field and the preview row follows whatever the
// reader points at - on the field, in the list, or on the rows themselves.
import { useCallback, useEffect, useRef } from 'react';

import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout } from '../engine/types';
import { levelOf } from './fusedModel';
import { useFusedStore } from './fusedStore';
import { HEAD_H, paintSpread, rowsWanted, type SpreadHit, type SpreadWords } from './spreadPaint';
import type { InstrumentColors } from './tokenColors';

interface Props {
  engine: GalaxyEngine | null;
  layout: GalaxyLayout;
  path: EnginePath;
  words: SpreadWords;
  waitingStars: Set<string>;
  lit: Set<string> | null;
  colors: InstrumentColors | null;
}

export function SpreadCanvas({ engine, layout, path, words, waitingStars, lit, colors }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const hits = useRef<SpreadHit[]>([]);
  const setTip = useFusedStore((st) => st.setTip);

  const draw = useCallback(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g || !engine || !colors) return;
    const W = cv.clientWidth;
    const dockH = cv.parentElement?.clientHeight ?? 0;
    const H = Math.max(10, Math.round(dockH - HEAD_H));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.height = `${H}px`;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const hover = engine.getHover();
    const rows = rowsWanted(path, hover);
    hits.current = paintSpread(g, W, H, layout, path, rows, colors, words, hover, waitingStars, lit);
  }, [engine, layout, path, words, waitingStars, lit, colors]);

  useEffect(() => {
    draw();
    return engine?.onFrame(draw);
  }, [draw, engine]);

  const pick = (e: React.PointerEvent | React.MouseEvent): SpreadHit | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: SpreadHit | null = null;
    for (const h of hits.current) {
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) {
        best = h;
        if (!h.unit) break;
      }
    }
    return best;
  };

  return (
    <canvas
      ref={ref}
      className="fz-dock-canvas"
      aria-hidden="true"
      onPointerMove={(e) => {
        const h = pick(e);
        if (ref.current) ref.current.style.cursor = h ? 'pointer' : 'default';
        engine?.setHover(h && !h.climb ? h.node : null);
        const host = ref.current?.closest('.fz')?.getBoundingClientRect();
        const r = ref.current?.getBoundingClientRect();
        setTip(h?.node && !h.climb && host && r ? { node: h.node, x: e.clientX - host.left, y: r.top - host.top - 8, above: true } : null);
      }}
      onPointerLeave={() => {
        engine?.setHover(null);
        setTip(null);
      }}
      onClick={(e) => {
        const h = pick(e);
        if (!h || !engine) return;
        if (h.climb) engine.climbTo(h.i);
        else if (h.node) engine.goTo(h.node);
        if (levelOf(path) === 0 && !h.node) engine.climbTo(0);
      }}
    />
  );
}

export default SpreadCanvas;
