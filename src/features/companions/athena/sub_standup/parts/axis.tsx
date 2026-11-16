/**
 * The page's two shared axes. Ticks are computed once per view and handed to
 * the column head (labels) and to every timeline cell (faint gridlines), so a
 * mark, a CPU bar and a block all sit on the same hour as the numeral above it.
 */
import { useMemo, type ReactNode } from 'react';

import type { Zoom } from '../model/keymap';
import { DAY_MS, hourTicks } from '../model/timeAxis';
import type { StandupView, Window } from '../model/types';
import { pct } from './svgUnits';

export interface Tick { pos: number; label: string }

/** Instrument numerals: always two digits, so a tick label never shifts its centre. */
const two = (n: number): string => String(n).padStart(2, '0');

export interface Axes {
  /** The Today column's window: the away log (today) or 12 days of host load. */
  today: Window;
  todayTicks: Tick[];
  nightTicks: Tick[];
  /** Where the clock stands on the night axis once armed, else null. */
  nowPos: number | null;
}

export function useAxes(view: StandupView, zoom: Zoom): Axes {
  return useMemo(() => {
    const long: Window = { from: view.past.to - 12 * DAY_MS, to: view.past.to };
    const today = zoom === 'today' ? view.past : long;
    const todayTicks = zoom === 'today'
      ? hourTicks(view.past, 2).map((x) => ({ pos: x.pos, label: two(x.hour) }))
      : hourTicks(long, 24).filter((_, i) => i % 2 === 0).map((x) => ({ pos: x.pos, label: two(new Date(long.from + x.pos * 12 * DAY_MS).getDate()) }));
    const nightTicks = hourTicks(view.night, 2).map((x) => ({ pos: x.pos, label: two(x.hour) }));
    const span = view.night.to - view.night.from;
    const nowPos = view.status === 'armed' && span > 0 ? Math.min(1, Math.max(0, (view.nowMs - view.night.from) / span)) : null;
    return { today, todayTicks, nightTicks, nowPos };
  }, [view.past, view.night, view.nowMs, view.status, zoom]);
}

/**
 * A timeline cell's drawing surface: faint hour gridlines at the shared ticks,
 * a hairline track (so an empty cell reads as an empty lane, not a hole), the
 * figure on top, and the clock line when the plan runs.
 */
export function Track({ ticks, nowPos, trackY = '50%', children }: { ticks: Tick[]; nowPos?: number | null; trackY?: string | null; children?: ReactNode }) {
  return (
    <svg className="sc-svg" aria-hidden="true">
      {ticks.map((tk) => <line key={tk.pos} className="sc-gl" x1={pct(tk.pos)} x2={pct(tk.pos)} y1="0" y2="100%" />)}
      {trackY && <line className="sc-trackline" x1="0" x2="100%" y1={trackY} y2={trackY} />}
      {children}
      {nowPos != null && <line className="sc-now" x1={pct(nowPos)} x2={pct(nowPos)} y1="0" y2="100%" />}
    </svg>
  );
}

/** The numerals under a column title, each centred on its tick. */
export function TickLabels({ ticks, now }: { ticks: Tick[]; now?: { pos: number; label: string } | null }) {
  // The readout tag anchors left, centre or right of its stroke so it never leaves the axis; numerals it covers step aside.
  const shift = now ? (now.pos > 0.92 ? -100 : now.pos < 0.08 ? 0 : -50) : 0;
  const from = now ? now.pos + (shift / 100) * 0.11 - 0.035 : 0;
  const covered = (p: number) => Boolean(now) && p > from && p < from + 0.18;
  return (
    <div className="sc-ticks" aria-hidden="true">
      {now && (
        <span className="sc-nowtag" style={{ left: pct(now.pos), transform: `translateX(${shift}%)` }}>{now.label}</span>
      )}
      {ticks.filter((tk) => !covered(tk.pos)).map((tk) => (
        <span key={tk.pos} className="sc-tick" style={{ left: pct(tk.pos) }}>{tk.label}</span>
      ))}
    </div>
  );
}
