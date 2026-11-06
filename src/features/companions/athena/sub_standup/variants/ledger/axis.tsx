/**
 * The ledger's two shared axes. Ticks are computed once per view and handed to
 * the column head (labels) and to every timeline cell (faint gridlines), so a
 * mark, a CPU bar and a block all sit on the same hour as the numeral above it.
 */
import { useMemo, type ReactNode } from 'react';

import type { Zoom } from '../../model/keymap';
import { DAY_MS, hourTicks } from '../../model/timeAxis';
import type { StandupView, Window } from '../../model/types';
import { pct } from '../../parts/svgUnits';

export interface Tick { pos: number; label: string }

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
      ? hourTicks(view.past, 2).map((x) => ({ pos: x.pos, label: String(x.hour) }))
      : hourTicks(long, 24).filter((_, i) => i % 2 === 0).map((x) => ({ pos: x.pos, label: String(new Date(long.from + x.pos * 12 * DAY_MS).getDate()) }));
    const nightTicks = hourTicks(view.night, 2).map((x) => ({ pos: x.pos, label: String(x.hour) }));
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
    <svg className="sl-svg" aria-hidden="true">
      {ticks.map((tk) => <line key={tk.pos} className="sl-gl" x1={pct(tk.pos)} x2={pct(tk.pos)} y1="0" y2="100%" />)}
      {trackY && <line className="sl-trackline" x1="0" x2="100%" y1={trackY} y2={trackY} />}
      {children}
      {nowPos != null && <line className="sl-now" x1={pct(nowPos)} x2={pct(nowPos)} y1="0" y2="100%" />}
    </svg>
  );
}

/** The numerals under a column title, each centred on its tick. */
export function TickLabels({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="sl-ticks" aria-hidden="true">
      {ticks.map((tk) => (
        <span key={tk.pos} className="sl-tick typo-caption" style={{ left: pct(tk.pos) }}>{tk.label}</span>
      ))}
    </div>
  );
}
