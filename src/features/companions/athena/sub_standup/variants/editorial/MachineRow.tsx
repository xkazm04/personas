import { memo, useMemo } from 'react';

import { Ghost, Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Zoom } from '../../model/keymap';
import { machineBars } from '../../model/machine';
import { clockLabel } from '../../model/timeAxis';
import type { MachineBar, StandupView } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { Track, type Axes } from './axis';
import { ED_COPY, fill } from './copy';

const FLOOR = 0.86;
const TALL = 0.7;

/** Host CPU per bin as thin bars on a baseline: green where an agent ran, a fine ink stipple where nothing was recorded. */
function CpuBars({ bars }: { bars: MachineBar[] }) {
  const width = bars[0]?.width ?? 1 / 36;
  const present = new Set(bars.map((b) => Math.round(b.pos * 1000)));
  const gaps: number[] = [];
  for (let p = 0; p < 1 - 1e-6; p += width) if (!present.has(Math.round(p * 1000))) gaps.push(p);
  return (
    <>
      {gaps.map((p) => <rect key={`g${p}`} className="se-gap" x={pct(p)} y={pct(FLOOR - 0.16)} width={pct(width)} height={pct(0.16)} />)}
      {bars.map((b) => {
        const h = Math.max(0.03, b.cpu) * TALL;
        return <rect key={b.pos} className={b.busy ? 'se-bar is-busy' : 'se-bar'} x={pct(b.pos + width * 0.22)} y={pct(FLOOR - h)} width={pct(width * 0.56)} height={pct(h)} />;
      })}
      <line className="se-base" x1="0" x2="100%" y1={pct(FLOOR)} y2={pct(FLOOR)} />
    </>
  );
}

/** Tonight's lanes: a hairline per lane, dead spots as a warm stipple, the plan's blocks as thin bars over it. */
function Lanes({ view }: { view: StandupView }) {
  const m = view.machine;
  const top = 0.24;
  const laneH = (FLOOR - top) / m.lanes;
  const barH = Math.min(laneH * 0.62, 0.2);
  return (
    <>
      {Array.from({ length: m.lanes }, (_, i) => (
        <g key={`l${i}`}>
          <rect className="se-dead" x="0" y={pct(top + i * laneH)} width="100%" height={pct(barH)} />
          <line className="se-lane" x1="0" x2="100%" y1={pct(top + i * laneH + barH)} y2={pct(top + i * laneH + barH)} />
        </g>
      ))}
      {m.laneBlocks.map((b) => {
        const geo = { x: pct(b.start), y: pct(top + b.lane * laneH), width: pct(Math.max(0.004, b.end - b.start)), height: pct(barH) };
        return (
          <g key={b.id}>
            <rect className="se-blk-ground" {...geo} />
            <rect className={`se-blk se-blk--${b.tone}`} {...geo} />
          </g>
        );
      })}
    </>
  );
}

interface Props {
  view: StandupView;
  zoom: Zoom;
  axes: Axes;
  utilizationLong: readonly HostUtilizationPoint[];
  loading: boolean;
  error?: string;
  onZoom: () => void;
}

/** The pinned first row: the machine on the same four columns as every project, drawn like a newspaper graphic. */
export const MachineRow = memo(function MachineRow({ view, zoom, axes, utilizationLong, loading, error, onZoom }: Props) {
  const { t } = useTranslation();
  const s = t.athena.standup.machine;
  const L = ED_COPY.machine;
  const m = view.machine;
  const hasPlan = m.laneBlocks.length > 0;
  const bars = useMemo(
    () => (zoom === 'today' ? view.machine.bars : machineBars(utilizationLong, axes.today).bars),
    [zoom, view.machine.bars, utilizationLong, axes.today],
  );
  const dead = Math.round(m.deadShare * 100);
  const span = zoom === 'today' ? ED_COPY.col.today_long : ED_COPY.col.today;
  return (
    <div className="se-machine se-grid" aria-label={s.label} role="group">
      <div className="se-cell se-c1 se-mname">
        <span className="se-serif">{L.name}</span>
        <span className="se-body se-num">{hasPlan ? fill(L.summary, { lanes: m.lanes, dead }) : L.summary_empty}</span>
      </div>
      <Hint content={error ?? `${zoom === 'today' ? L.cpu_hint : L.cpu_hint_long} ${fill(L.zoom, { span })}`}>
        <div
          className="se-cell se-c2 se-mfig se-zoomable focus-ring"
          role="button"
          tabIndex={0}
          aria-label={fill(L.zoom, { span })}
          onClick={onZoom}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onZoom(); } }}
        >
          {loading && bars.length === 0
            ? <div className="se-mghost"><Ghost width="100%" height="2rem" /></div>
            : <Track ticks={axes.todayTicks} trackY={null}><CpuBars bars={bars} /></Track>}
        </div>
      </Hint>
      <div className="se-cell se-c3 se-mnow">
        <span className="se-clock se-num">{clockLabel(view.nowMs)}</span>
        <span className="se-sc">{view.status === 'armed' ? s.now_armed : s.now_draft}</span>
      </div>
      <Hint content={hasPlan ? fill(L.lanes_hint, { lanes: m.lanes, units: m.peakUnits, dead }) : s.night_empty}>
        <div className="se-cell se-c4 se-mfig">
          <Track ticks={axes.nightTicks} nowPos={axes.nowPos} nowLabel trackY={hasPlan ? null : '50%'}>{hasPlan && <Lanes view={view} />}</Track>
        </div>
      </Hint>
    </div>
  );
});
