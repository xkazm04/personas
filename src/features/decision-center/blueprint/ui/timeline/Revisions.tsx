import { useMemo, useRef } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import { fmtNum } from '../format';
import { fmtDay } from './dates';
import { revModel, FILLS, type RevWords } from './revModel';
import { useSize, useSlider, useTime } from './useSlider';

/**
 * The revisions chart (bp BaseBar Revisions): features by stage per weekly revision as a stacked area (live .62,
 * flagged .44, review .3, dev .2, specified .11, idea .06, demolish red .5), the last milestone done (an ink flag), the
 * next one planned (an amber dashed flag with the days to it), the store's releases, week dates and the amber handle
 * plate at the time shown. Labels are placed by priority and culled where they would collide. It is the panel's time
 * slider: press or drag to travel, the arrows step a week, Home goes to the first week, End to now.
 */
export function Revisions() {
  const s = useSheet(), { B, tx, language } = s.text, S = s.plan.S, { t, now, rev, total } = useTime();
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [W, H] = useSize(wrap, 640, 92);
  const words = useMemo<RevWords>(() => ({
    title: B.tl_chart_title, titleShort: B.tl_chart_title_short, step: B.tl_step,
    weeks: (n) => tx(n === 1 ? B.tl_weeks_one : B.tl_weeks_other, { count: n }), max: (n) => tx(B.tl_max, { n: fmtNum(language, n) }),
    band: (st, n) => tx(B.tl_band, { stage: stageWord(B, st), count: n }), day: (d) => fmtDay(language, d).toUpperCase(),
    days: (n) => tx(B.tl_days, { count: n }), plate: (isNow) => (isNow ? tx(B.tl_plate_now, { n: total }) : tx(B.tl_plate_past, { n: rev, date: fmtDay(language, t) })).toUpperCase(),
  }), [B, tx, language, total, rev, t]);
  const m = useMemo(() => revModel({ W, H, weeks: S.weeks, snapshots: S.snapshots, milestones: S.milestones, asOf: S.asOf, t, releases: s.data.scan.releases, words }), [W, H, S, t, s.data.scan.releases, words]);
  const { props } = useSlider(svg, W, m.g);
  const txt = (k: string, className?: string) => {
    const l = m.cand.find((c) => c.k === k);
    return l && m.shown.has(k) ? <text key={k} className={className} x={l.x} y={l.y} textAnchor={l.a === 'start' ? undefined : l.a}>{l.s}</text> : null;
  };
  const { top, bot, h1, xm, hx, plate } = m;
  return (
    <div className="tl-revs" ref={wrap}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} aria-label={tx(B.tl_slider, { count: S.weeks.length })} {...props} data-testid="blueprint-revisions">
        {txt('rev', 'lbl')}{txt('nw')}{txt('sc')}{txt('step')}
        {m.bands.map((b) => (b.rect
          ? <rect key={b.st} className={b.st === 'deprecated' ? 'band dep' : 'band'} x={b.rect.x} y={b.rect.y} width={b.rect.w} height={b.rect.h} fillOpacity={FILLS[b.st]} />
          : <polygon key={b.st} className={b.st === 'deprecated' ? 'band dep' : 'band'} points={b.points} fillOpacity={FILLS[b.st]} />))}
        {m.bandKeys.filter((k) => m.shown.has(k)).map((k) => {
          const l = m.cand.find((c) => c.k === k)!, bx = m.boxOf(l);
          return <g key={k}><rect className="plate-bg" x={bx.x0 - 3} y={bx.y0 + 1} width={bx.x1 - bx.x0 + 6} height={bx.y1 - bx.y0 - 1} />{txt(k)}</g>;
        })}
        <line className="ax" x1={m.L} y1={bot} x2={h1} y2={bot} />
        {S.snapshots.map((sn, i) => { const x = hx(sn.week); return <g key={sn.week}><line className="ax tick" x1={x} y1={bot} x2={x} y2={bot + 4} />{txt('w' + i)}</g>; })}
        {m.rels.map((r) => <g key={r.id} className="rel"><line x1={r.x} y1={top - 2} x2={r.x} y2={bot} />{txt('r_' + r.id)}</g>)}
        {m.m1 && <g className="ms"><line x1={hx(m.m1.date)} y1={top - 16} x2={hx(m.m1.date)} y2={bot} /><path d={`M${hx(m.m1.date)} ${top - 16} h10 l-3 4 l3 4 h-10z`} />{txt('m1')}</g>}
        {m.m2 && m.R > h1 && <line className="future" x1={h1} y1={bot} x2={m.R} y2={bot} />}
        {m.m2 && <g className="ms next"><line x1={xm} y1={top - 14} x2={xm} y2={bot} /><path d={`M${xm} ${top - 14} h-10 l3 4 l-3 4 h10z`} />{txt('m2')}{txt('days')}</g>}
        <g className={'handle' + (now ? '' : ' travel')}>
          <line x1={plate.hl} y1={top - 16} x2={plate.hl} y2={bot + 2} />
          <rect x={plate.px0} y={bot + 8} width={plate.pw} height={20} />
          <text x={plate.px0 + plate.pw / 2} y={bot + 22.5} textAnchor="middle">{plate.lab}</text>
          <path d={`M${plate.hl - 5} ${bot + 8} l5 -6 l5 6z`} />
        </g>
      </svg>
    </div>
  );
}
