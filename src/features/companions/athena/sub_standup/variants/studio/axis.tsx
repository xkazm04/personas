/**
 * The two shared axes. Ticks are computed once per view and handed to the
 * column head (labels) and to every timeline cell (faint gridlines), so a mark,
 * a CPU bar and a block all sit on the hour of the numeral above them. The
 * drawing surface is HTML, not SVG: rounded caps, gradients and the NOW glow
 * are plain CSS on positioned elements.
 */
import { useMemo, type ReactNode } from 'react';

import type { Zoom } from '../../model/keymap';
import { clockLabel, DAY_MS, hourTicks } from '../../model/timeAxis';
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
  nowLabel: string;
}

export function useAxes(view: StandupView, zoom: Zoom): Axes {
  return useMemo(() => {
    const long: Window = { from: view.past.to - 12 * DAY_MS, to: view.past.to };
    const today = zoom === 'today' ? view.past : long;
    const todayTicks = zoom === 'today'
      ? hourTicks(view.past, 2).map((x) => ({ pos: x.pos, label: String(x.hour).padStart(2, '0') }))
      : hourTicks(long, 24).filter((_, i) => i % 2 === 0).map((x) => ({ pos: x.pos, label: String(new Date(long.from + x.pos * 12 * DAY_MS).getDate()) }));
    const nightTicks = hourTicks(view.night, 2).map((x) => ({ pos: x.pos, label: String(x.hour).padStart(2, '0') }));
    const span = view.night.to - view.night.from;
    const nowPos = view.status === 'armed' && span > 0 ? Math.min(1, Math.max(0, (view.nowMs - view.night.from) / span)) : null;
    return { today, todayTicks, nightTicks, nowPos, nowLabel: clockLabel(view.nowMs) };
  }, [view.past, view.night, view.nowMs, view.status, zoom]);
}

/**
 * A timeline cell's drawing surface: faint hour gridlines at the shared ticks,
 * an optional rounded lane (an empty cell reads as an empty lane, not a hole),
 * the figure on top, and the NOW line when the plan runs.
 */
export function Track({ ticks, nowPos, lane = false, children }: { ticks: Tick[]; nowPos?: number | null; lane?: boolean; children?: ReactNode }) {
  return (
    <div className="ss-track" aria-hidden="true">
      {ticks.map((tk) => <i key={tk.pos} className="ss-gl" style={{ left: pct(tk.pos) }} />)}
      {lane && <i className="ss-lane" />}
      {children}
      {nowPos != null && <i className="ss-now" style={{ left: pct(nowPos) }} />}
    </div>
  );
}

/** The numerals under a column title, each centred on its tick; the NOW pill rides over them. */
export function TickLabels({ ticks, nowPos, nowLabel }: { ticks: Tick[]; nowPos?: number | null; nowLabel?: string }) {
  return (
    <div className="ss-ticks" aria-hidden="true">
      {ticks.map((tk) => (
        <span key={tk.pos} className={`ss-tick ${nowPos != null && Math.abs(tk.pos - nowPos) < 0.06 ? 'is-under' : ''}`} style={{ left: pct(tk.pos) }}>{tk.label}</span>
      ))}
      {nowPos != null && (
        <span className={`ss-nowpill ${nowPos > 0.93 ? 'is-end' : nowPos < 0.07 ? 'is-start' : ''}`} style={{ left: pct(nowPos) }}>{nowLabel}</span>
      )}
    </div>
  );
}
