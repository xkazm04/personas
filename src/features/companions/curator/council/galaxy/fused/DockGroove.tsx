// The groove: the whole cross-section of the scope compressed into one line
// of ticks above the care cells. Care subjects stand tall in their claim
// colour, councilled ones are thin marks, the rest a faint floor; a thread
// runs from every visible cell back to its tick, so the strip still says
// WHERE in the registry the trouble sits. A click flies to the nearest tick.
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type { GalaxyEngine } from '../engine/GalaxyEngine';
import type { SubjectNode } from '../engine/types';
import { careTone } from './careModel';
import { useFusedStore } from './fusedStore';
import { toneColor, type InstrumentColors } from './tokenColors';

interface Props {
  engine: GalaxyEngine | null;
  subjects: SubjectNode[];
  care: Set<SubjectNode>;
  waitingStars: Set<string>;
  bySky: boolean;
  here: SubjectNode | null;
  cellsRef: RefObject<HTMLDivElement | null>;
  colors: InstrumentColors | null;
}

const H = 20;
const BASE = 9;

export function DockGroove({ engine, subjects, care, waitingStars, bySky, here, cellsRef, colors }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const units = useRef<Array<{ s: SubjectNode; x: number }>>([]);
  const setTip = useFusedStore((st) => st.setTip);

  const draw = useCallback(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g || !colors || cv.clientWidth === 0) return;
    const W = cv.clientWidth;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
    if (cv.height !== H * dpr) cv.height = H * dpr;
    const col = colors;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const x0 = 14;
    const uw = (W - 28) / Math.max(1, subjects.length);
    units.current = subjects.map((s, k) => ({ s, x: x0 + (k + 0.5) * uw }));
    g.fillStyle = col.muted;
    g.globalAlpha = 0.35;
    subjects.forEach((s, k) => {
      const prev = subjects[k - 1];
      if (prev && (bySky ? prev.domain !== s.domain : prev.category !== s.category)) g.fillRect(x0 + k * uw - 0.5, 1, 1, BASE);
    });
    const hov = engine?.getHover();
    subjects.forEach((s, k) => {
      const x = x0 + k * uw;
      const tone = toneColor(col, careTone(s, waitingStars));
      if (care.has(s)) {
        g.fillStyle = tone;
        g.globalAlpha = 1;
        g.fillRect(x + uw / 2 - 1, 0, 2, BASE);
      } else if (s.mark !== 'none') {
        g.fillStyle = tone;
        g.globalAlpha = 0.55;
        g.fillRect(x + uw / 2 - 0.5, 4, 1, BASE - 4);
      } else {
        g.fillStyle = col.none;
        g.globalAlpha = col.light ? 0.3 : 0.26;
        g.fillRect(x, BASE - 3, Math.max(0.6, uw - (uw > 3 ? 1 : 0)), 3);
      }
      if (s === hov || s === here) {
        g.fillStyle = col.accent;
        g.globalAlpha = 1;
        g.fillRect(x + uw / 2 - 1.5, 0, 3, BASE);
      }
    });
    // Ties: tick to cell, for every cell the strip shows.
    const cells = cellsRef.current;
    const cr = cells?.getBoundingClientRect();
    const gr = cv.getBoundingClientRect();
    cells?.querySelectorAll<HTMLElement>('.cell').forEach((c) => {
      const r = c.getBoundingClientRect();
      if (!cr || r.right < cr.left + 4 || r.left > cr.right - 4) return;
      const u = units.current.find((q) => q.s.slug === c.dataset.s);
      if (!u) return;
      const bx = r.left - gr.left + 12;
      const hot = u.s === hov;
      g.strokeStyle = hot ? col.accent : toneColor(col, careTone(u.s, waitingStars));
      g.globalAlpha = hot ? 0.95 : 0.45;
      g.lineWidth = hot ? 1.5 : 1;
      g.beginPath();
      g.moveTo(u.x, BASE + 1);
      g.bezierCurveTo(u.x, BASE + 7, bx, H - 7, bx, H);
      g.stroke();
    });
    g.globalAlpha = 1;
  }, [engine, subjects, care, waitingStars, bySky, here, cellsRef, colors]);

  useEffect(() => {
    draw();
    const cells = cellsRef.current;
    cells?.addEventListener('scroll', draw);
    const off = engine?.onFrame(draw);
    return () => {
      cells?.removeEventListener('scroll', draw);
      off?.();
    };
  }, [draw, engine, cellsRef]);

  const nearest = (clientX: number): SubjectNode | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const x = clientX - r.left;
    let best: SubjectNode | null = null;
    let bd = Infinity;
    for (const u of units.current) {
      const d = Math.abs(u.x - x) - (care.has(u.s) ? 6 : 0);
      if (d < bd) {
        bd = d;
        best = u.s;
      }
    }
    return best;
  };

  return (
    <canvas
      ref={ref}
      className="fz-groove"
      aria-hidden="true"
      data-role="hud-groove"
      onClick={(e) => {
        const s = nearest(e.clientX);
        if (s) engine?.goTo(s);
      }}
      onPointerMove={(e) => {
        const s = nearest(e.clientX);
        engine?.setHover(s);
        const host = ref.current?.closest('.fz')?.getBoundingClientRect();
        const r = ref.current?.getBoundingClientRect();
        if (s && host && r) setTip({ node: s, x: e.clientX - host.left, y: r.top - host.top - 8, above: true });
        draw();
      }}
      onPointerLeave={() => {
        engine?.setHover(null);
        setTip(null);
        draw();
      }}
    />
  );
}

export default DockGroove;
