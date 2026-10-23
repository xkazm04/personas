import { useRef } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { fmtDay } from './dates';
import { histX, type ScrubGeom } from './scrub';
import { useSize, useSlider, useTime } from './useSlider';

/**
 * The hairline (bp timeline/Strip.tsx Hairline): the revision history as a sparkline of the weekly feature totals over a
 * faint area, a tick per week on the base line, the last milestone done, and the amber handle at the time the plan is
 * drawn at. It is a slider: click or drag along it to travel, the arrows step a week, End returns to now. Travelled,
 * the handle turns accent and a date flag stands over it.
 */
export function Hairline() {
  const s = useSheet(), { B, tx, language } = s.text, S = s.plan.S;
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [W, H] = useSize(wrap, 600, 26);
  const { t, now } = useTime();
  const L = 4, R = W - 4, top = 4, bot = H - 6;
  const g: ScrubGeom = { h0: L, h1: R, weeks: S.weeks, asOf: S.asOf }, x = (d: string) => histX(g, d);
  const snaps = S.snapshots, max = Math.max(1, ...snaps.map((sn) => sn.total));
  const pts = snaps.map((sn) => x(sn.week).toFixed(1) + ',' + (bot - (sn.total / max) * (bot - top)).toFixed(1));
  const line = pts.length > 1 ? 'M' + pts.join(' L') : '';
  const area = line ? `${line} L${x(snaps[snaps.length - 1]!.week).toFixed(1)},${bot} L${x(snaps[0]!.week).toFixed(1)},${bot}Z` : '';
  const m1 = S.milestones.filter((m) => m.state === 'done' && (!S.weeks[0] || m.date >= S.weeks[0])).pop();
  const xt = Math.min(x(t), R);
  const { props } = useSlider(svg, W, g);
  return (
    <div className="tl-line" ref={wrap}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} aria-label={tx(B.tl_slider, { count: S.weeks.length })} {...props}>
        <rect className="tl-hit" x={0} y={0} width={W} height={H} />
        {area && <path className="tl-area" d={area} />}
        {line && <path className="tl-spark" d={line} />}
        <line className="tl-base" x1={L} y1={bot} x2={R} y2={bot} />
        {S.weeks.map((w) => { const wx = x(w); return <line key={w} className="tl-tick" x1={wx} y1={bot} x2={wx} y2={bot + 3} />; })}
        {m1 && <line className="tl-ms" x1={x(m1.date)} y1={top - 2} x2={x(m1.date)} y2={bot} />}
        <g className={'tl-handle' + (now ? ' now' : '')}>
          <line x1={xt} y1={1} x2={xt} y2={H - 1} />
          <path d={`M${xt - 4} ${H} l4 -5 l4 5z`} />
        </g>
      </svg>
      {!now && <span className="tl-flag" aria-hidden="true" style={{ left: Math.max(0, Math.min(xt - 40, W - 84)) }}>{fmtDay(language, t)}</span>}
    </div>
  );
}
