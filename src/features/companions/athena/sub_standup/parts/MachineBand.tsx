import { memo, useMemo } from 'react';

import { Ghost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Zoom } from '../model/keymap';
import { machineBars } from '../model/machine';
import { clockLabel, DAY_MS, hourTicks, pos } from '../model/timeAxis';
import type { MachineBar, StandupView, Window } from '../model/types';
import { Kbd } from './Kbd';
import { pct } from './svgUnits';

const BASE = 0.8; // bars stand on 80% of the cell; the axis labels sit under it
const TALL = 0.55;

/** Past: measured host CPU per bin, green where an agent ran, hatched where nothing was recorded. */
function PastBars({ bars, ticks }: { bars: MachineBar[]; ticks: Array<{ pos: number; label: string }> }) {
  const present = new Set(bars.map((b) => Math.round(b.pos * 1000)));
  const width = bars[0]?.width ?? 1 / 36;
  const gaps: number[] = [];
  for (let p = 0; p < 1 - 1e-6; p += width) if (!present.has(Math.round(p * 1000))) gaps.push(p);
  return (
    <svg aria-hidden="true">
      {gaps.map((p) => <rect key={`g${p}`} className="su-gap" x={pct(p)} y={pct(BASE - TALL)} width={pct(width)} height={pct(TALL)} />)}
      {bars.map((b) => {
        const h = Math.max(0.03, b.cpu) * TALL;
        return <rect key={b.pos} className={b.busy ? 'su-bar su-bar--busy' : 'su-bar'} x={pct(b.pos + width * 0.08)} y={pct(BASE - h)} width={pct(width * 0.84)} height={pct(h)} />;
      })}
      {ticks.map((tk) => <text key={tk.pos} className="su-axis typo-label" x={pct(tk.pos)} y="96%" textAnchor="middle">{tk.label}</text>)}
    </svg>
  );
}

/** Tonight: the forecast in lanes; amber is lane-time nothing fills (a dead spot). */
function NightLanes({ view }: { view: StandupView }) {
  const m = view.machine;
  const laneH = TALL / m.lanes;
  const top = BASE - TALL;
  const ticks = hourTicks(view.night, 2);
  const now = view.status === 'armed' ? pos(view.nowMs, view.night) : null;
  return (
    <svg aria-hidden="true">
      {Array.from({ length: m.lanes }, (_, i) => (
        <rect key={`l${i}`} className="su-lane-bg" x="0" y={pct(top + i * laneH)} width="100%" height={pct(laneH * 0.86)} />
      ))}
      {m.laneBlocks.map((b) => (
        <rect key={b.id} className={`su-blk su-blk--${b.tone}`} x={pct(b.start)} y={pct(top + b.lane * laneH)} width={pct(Math.max(0.002, b.end - b.start))} height={pct(laneH * 0.86)} />
      ))}
      {ticks.map((tk) => <text key={tk.pos} className="su-axis typo-label" x={pct(tk.pos)} y="96%" textAnchor="middle">{tk.hour}</text>)}
      {now !== null && <line className="su-nowline" x1={pct(now)} x2={pct(now)} y1="0" y2="100%" />}
    </svg>
  );
}

interface Props {
  view: StandupView;
  zoom: Zoom;
  utilizationLong: readonly HostUtilizationPoint[];
  loading: boolean;
  error?: string;
}

/** B/1's machine row: the past (measured), NOW, and tonight (forecast), on the table's own columns. */
export const MachineBand = memo(function MachineBand({ view, zoom, utilizationLong, loading, error }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.machine;
  const long: Window = useMemo(() => ({ from: view.past.to - 12 * DAY_MS, to: view.past.to }), [view.past.to]);
  const past = useMemo(() => {
    if (zoom === 'today') return { bars: view.machine.bars, ticks: hourTicks(view.past, 2).map((x) => ({ pos: x.pos, label: String(x.hour) })) };
    const { bars } = machineBars(utilizationLong, long);
    const ticks = hourTicks(long, 24).filter((_, i) => i % 2 === 0).map((x) => ({ pos: x.pos, label: String(new Date(long.from + x.pos * 12 * DAY_MS).getDate()) }));
    return { bars, ticks };
  }, [zoom, view.machine.bars, view.past, utilizationLong, long]);
  const m = view.machine;
  const hasPlan = m.laneBlocks.length > 0;
  return (
    <section className="su-band su-grid" aria-label={s.label}>
      <div className="su-band__label">
        <span className="typo-eyebrow text-foreground">{s.label}</span>
        <span className="typo-caption"><Kbd>Z</Kbd> {zoom === 'today' ? s.zoom_today : s.zoom_long}</span>
      </div>
      <div>
        {loading && past.bars.length === 0 ? <div className="absolute inset-x-3 top-8"><Ghost width="100%" height="2.5rem" /></div> : <PastBars bars={past.bars} ticks={past.ticks} />}
        <span className={`su-band__caption typo-caption ${error ? 'su-error' : ''}`}>{error ?? (zoom === 'today' ? s.past_caption : s.long_caption)}</span>
      </div>
      <div className="su-band__now">
        <span className="typo-data-lg text-foreground">{clockLabel(view.nowMs)}</span>
        <span className="typo-caption">{view.status === 'armed' ? s.now_armed : s.now_draft}</span>
      </div>
      <div>
        {hasPlan && <NightLanes view={view} />}
        <span className="su-band__caption typo-caption">
          {hasPlan ? tx(s.night_caption, { lanes: m.lanes, dead: Math.round(m.deadShare * 100), units: m.peakUnits }) : s.night_empty}
        </span>
      </div>
    </section>
  );
});
