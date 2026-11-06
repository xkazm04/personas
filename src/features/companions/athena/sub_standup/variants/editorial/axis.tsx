/**
 * The page's two shared axes. Ticks are computed once per view and handed to the column head
 * (numerals) and to every timeline cell (hairline hour rules), so a mark, a CPU bar and a block
 * all sit on the same hour as the numeral above it. Patterns (stipple, hatch) are declared once.
 */
import { useMemo, type ReactNode } from 'react';

import type { Zoom } from '../../model/keymap';
import { DAY_MS, hourTicks } from '../../model/timeAxis';
import type { StandupView, Window } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { ED_COPY } from './copy';

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
      ? hourTicks(view.past, 2).map((x) => ({ pos: x.pos, label: String(x.hour).padStart(2, '0') }))
      : hourTicks(long, 24).filter((_, i) => i % 2 === 0).map((x) => ({ pos: x.pos, label: String(new Date(long.from + x.pos * 12 * DAY_MS).getDate()) }));
    const nightTicks = hourTicks(view.night, 2).map((x) => ({ pos: x.pos, label: String(x.hour).padStart(2, '0') }));
    const span = view.night.to - view.night.from;
    const nowPos = view.status === 'armed' && span > 0 ? Math.min(1, Math.max(0, (view.nowMs - view.night.from) / span)) : null;
    return { today, todayTicks, nightTicks, nowPos };
  }, [view.past, view.night, view.nowMs, view.status, zoom]);
}

/** The page's fills, declared once: a warm stipple for dead spots, an ink stipple for unrecorded time, a still hatch for running. */
export function PatternDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
      <defs>
        <pattern id="se-stipple" width="4" height="4" patternUnits="userSpaceOnUse"><circle className="se-pat-dot" cx="1" cy="1" r="0.75" /><circle className="se-pat-dot" cx="3" cy="3" r="0.75" /></pattern>
        <pattern id="se-stipple-ink" width="3" height="3" patternUnits="userSpaceOnUse"><circle className="se-pat-ink" cx="1.5" cy="1.5" r="0.6" /></pattern>
        <pattern id="se-hatch" width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line className="se-pat-hatch" x1="0" y1="0" x2="0" y2="3.5" /></pattern>
      </defs>
    </svg>
  );
}

/**
 * A timeline cell's drawing surface: hairline hour rules at the shared ticks, a dotted lane (so an
 * empty cell reads as an empty lane, not a hole), the figure on top, and the clock as a fine ink
 * rule with an italic serif label once the plan runs.
 */
export function Track({ ticks, nowPos, nowLabel = false, trackY = '50%', children }: {
  ticks: Tick[]; nowPos?: number | null; nowLabel?: boolean; trackY?: string | null; children?: ReactNode;
}) {
  return (
    <svg className="se-svg" aria-hidden="true">
      {ticks.map((tk) => <line key={tk.pos} className="se-gl" x1={pct(tk.pos)} x2={pct(tk.pos)} y1="0" y2="100%" />)}
      {trackY && <line className="se-trackline" x1="0" x2="100%" y1={trackY} y2={trackY} />}
      {children}
      {nowPos != null && <line className="se-now" x1={pct(nowPos)} x2={pct(nowPos)} y1={nowLabel ? '15' : '0'} y2="100%" />}
      {nowPos != null && nowLabel && (
        <svg x={pct(nowPos)} y="0" overflow="visible">
          <text className="se-now-label" x={nowPos > 0.85 ? -4 : 4} y="12" textAnchor={nowPos > 0.85 ? 'end' : 'start'}>{ED_COPY.machine.now}</text>
        </svg>
      )}
    </svg>
  );
}

/** The numerals under a column title, each centred on its tick. */
export function TickLabels({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="se-ticks" aria-hidden="true">
      {ticks.map((tk) => (
        <span key={tk.pos} className="se-tick se-num" style={{ left: pct(tk.pos) }}>{tk.label}</span>
      ))}
    </div>
  );
}
