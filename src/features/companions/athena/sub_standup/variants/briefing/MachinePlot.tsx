import { memo, useMemo } from 'react';

import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Zoom } from '../../model/keymap';
import { machineBars } from '../../model/machine';
import { DAY_MS, hourTicks, pos } from '../../model/timeAxis';
import type { MachineBar, StandupView, Window } from '../../model/types';
import { pct } from '../../parts/svgUnits';

/** Vertical geometry in px; horizontal is a share of the one axis (today | tonight). */
const TOP = 22;
const LANE_H = 20;
const LANE_GAP = 6;
const MIN_BAND = 64;
const AXIS = 24;

export function plotHeight(lanes: number): number {
  return TOP + Math.max(MIN_BAND, lanes * (LANE_H + LANE_GAP)) + AXIS;
}

interface Tick { x: number; label: string }

/** Past CPU bars on [0, split]; unrecorded bins hatched. */
function Bars({ bars, split, base, band }: { bars: MachineBar[]; split: number; base: number; band: number }) {
  const width = bars[0]?.width ?? 1 / 36;
  const present = new Set(bars.map((b) => Math.round(b.pos * 1000)));
  const gaps: number[] = [];
  for (let p = 0; p < 1 - 1e-6; p += width) if (!present.has(Math.round(p * 1000))) gaps.push(p);
  return (
    <>
      {gaps.map((p) => <rect key={`g${p}`} className="su-gap" x={pct(p * split)} y={base - band * 0.5} width={pct(width * split)} height={band * 0.5} />)}
      {bars.map((b) => {
        const h = Math.max(2, b.cpu * band);
        return <rect key={b.pos} className={b.busy ? 'su-bar su-bar--busy' : 'su-bar'} x={pct((b.pos + width * 0.1) * split)} y={base - h} width={pct(width * 0.8 * split)} height={h} rx="1.5" />;
      })}
    </>
  );
}

/** Tonight's lanes on [split, 1]: the lane is the dead spot, blocks are what fills it. */
function Lanes({ view, split, base }: { view: StandupView; split: number; base: number }) {
  const m = view.machine;
  const x = (p: number) => split + p * (1 - split);
  const laneY = (i: number) => base - (i + 1) * (LANE_H + LANE_GAP) + LANE_GAP;
  return (
    <>
      {Array.from({ length: m.lanes }, (_, i) => (
        <rect key={`l${i}`} className="su-lane-bg" x={pct(split)} y={laneY(i)} width={pct(1 - split)} height={LANE_H} rx="3" />
      ))}
      {m.laneBlocks.map((b) => (
        <rect key={b.id} className={`su-blk su-blk--${b.tone}`} x={pct(x(b.start))} y={laneY(b.lane)} width={pct(Math.max(0.003, (b.end - b.start) * (1 - split)))} height={LANE_H} rx="3" />
      ))}
    </>
  );
}

/**
 * Today and tonight on ONE time axis: measured host CPU up to the pivot (the
 * moment the plan was armed, or now while it is a draft), then the forecast
 * lanes. The NOW line walks right of the pivot once armed. Labels in the
 * drawing are axis figures only; names live in the HTML above and below it.
 */
export const MachinePlot = memo(function MachinePlot({ view, zoom, utilizationLong, nowLabel }: {
  view: StandupView;
  zoom: Zoom;
  utilizationLong: readonly HostUtilizationPoint[];
  nowLabel: string;
}) {
  const all: Window = useMemo(() => ({ from: view.past.from, to: view.night.to }), [view.past.from, view.night.to]);
  const split = pos(view.past.to, all);
  const band = Math.max(MIN_BAND, view.machine.lanes * (LANE_H + LANE_GAP));
  const base = TOP + band;
  const long: Window = useMemo(() => ({ from: view.past.to - 12 * DAY_MS, to: view.past.to }), [view.past.to]);
  const { bars, ticks } = useMemo(() => {
    if (zoom === 'today') {
      return { bars: view.machine.bars, ticks: hourTicks(all, 2).map((tk): Tick => ({ x: tk.pos, label: String(tk.hour) })) };
    }
    const left = hourTicks(long, 24).filter((_, i) => i % 2 === 0).map((tk): Tick => ({ x: tk.pos * split, label: String(new Date(long.from + tk.pos * 12 * DAY_MS).getDate()) }));
    const right = hourTicks(view.night, 2).map((tk): Tick => ({ x: split + tk.pos * (1 - split), label: String(tk.hour) }));
    return { bars: machineBars(utilizationLong, long).bars, ticks: [...left, ...right] };
  }, [zoom, view.machine.bars, view.night, all, long, split, utilizationLong]);
  const now = view.status === 'armed' ? pos(view.nowMs, all) : split;
  const anchorEnd = now > 0.8;
  return (
    <svg className="sb-plot" aria-hidden="true">
      <line className="sb-plot__base" x1="0" x2="100%" y1={base + 0.5} y2={base + 0.5} />
      <Bars bars={bars} split={split} base={base} band={band} />
      <Lanes view={view} split={split} base={base} />
      {view.status === 'armed' && <line className="sb-plot__pivot" x1={pct(split)} x2={pct(split)} y1={TOP - 4} y2={base} />}
      {ticks.map((tk) => <text key={`${tk.x}`} className="sb-axis typo-label" x={pct(tk.x)} y={base + AXIS - 4} textAnchor="middle">{tk.label}</text>)}
      <line className="su-nowline" x1={pct(now)} x2={pct(now)} y1={TOP - 6} y2={base + 4} />
      <text className="sb-now typo-label" x={pct(now)} dx={anchorEnd ? -6 : 6} y={TOP - 8} textAnchor={anchorEnd ? 'end' : 'start'}>{nowLabel}</text>
    </svg>
  );
});
