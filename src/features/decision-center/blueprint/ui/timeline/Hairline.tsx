import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../standard/load';

const day = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z') / 86_400_000;

/** The strip's box, measured (bp timeline/shared useSize), so the sparkline is drawn in real pixels. */
function useSize(el: React.RefObject<HTMLElement | null>, w0: number, h0: number): [number, number] {
  const [s, setS] = useState<[number, number]>([w0, h0]);
  useEffect(() => {
    const n = el.current;
    if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const r = n.getBoundingClientRect(); if (r.width && r.height) setS([Math.round(r.width), Math.round(r.height)]); });
    ro.observe(n);
    return () => ro.disconnect();
  }, [el]);
  return s;
}

/**
 * The hairline (bp timeline/Strip.tsx Hairline): the revision history as a sparkline of the weekly feature totals
 * over a faint area, a tick per week on the base line, and the amber handle at now. Drawn only: dragging it to travel
 * is Stage D, so it is not a slider yet.
 */
export function Hairline({ weeks, snapshots, asOf, label }: { weeks: string[]; snapshots: Snapshot[]; asOf: string; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, H] = useSize(wrap, 600, 26);
  const L = 4, R = W - 4, top = 4, bot = H - 6;
  const d0 = weeks.length ? day(weeks[0]!) : day(asOf), d1 = day(asOf), span = Math.max(1, d1 - d0);
  const x = (d: string) => L + ((day(d) - d0) / span) * (R - L);
  const max = Math.max(1, ...snapshots.map((s) => s.total));
  const pts = snapshots.map((sn) => x(sn.week).toFixed(1) + ',' + (bot - (sn.total / max) * (bot - top)).toFixed(1));
  const line = pts.length > 1 ? 'M' + pts.join(' L') : '';
  const area = line ? `${line} L${x(snapshots[snapshots.length - 1]!.week).toFixed(1)},${bot} L${x(snapshots[0]!.week).toFixed(1)},${bot}Z` : '';
  const xt = Math.min(x(asOf), R);
  return (
    <div className="tl-line" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {area && <path className="tl-area" d={area} />}
        {line && <path className="tl-spark" d={line} />}
        <line className="tl-base" x1={L} y1={bot} x2={R} y2={bot} />
        {weeks.map((w) => { const wx = x(w); return <line key={w} className="tl-tick" x1={wx} y1={bot} x2={wx} y2={bot + 3} />; })}
        <g className="tl-handle">
          <line x1={xt} y1={1} x2={xt} y2={H - 1} />
          <path d={`M${xt - 4} ${H} l4 -5 l4 5z`} />
        </g>
      </svg>
    </div>
  );
}
