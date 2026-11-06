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
import { CONSOLE_COPY, fill } from './copy';

const FLOOR = 0.86;
const TALL = 0.7;

/** Host CPU per bin as fine strokes off one baseline; green where an agent ran, a dotted floor where nothing was recorded. */
function CpuTrace({ bars }: { bars: MachineBar[] }) {
  const width = bars[0]?.width ?? 1 / 36;
  const present = new Set(bars.map((b) => Math.round(b.pos * 1000)));
  const gaps: number[] = [];
  for (let p = 0; p < 1 - 1e-6; p += width) if (!present.has(Math.round(p * 1000))) gaps.push(p);
  return (
    <>
      <line className="sc-base" x1="0" x2="100%" y1={pct(FLOOR)} y2={pct(FLOOR)} />
      {gaps.map((p) => <rect key={`g${p}`} className="sc-gap" x={pct(p)} y={pct(FLOOR - 0.16)} width={pct(width)} height={pct(0.16)} />)}
      {bars.map((b) => {
        const h = Math.max(0.03, b.cpu) * TALL;
        return <rect key={b.pos} className={b.busy ? 'sc-bar is-busy' : 'sc-bar'} x={pct(b.pos + width * 0.3)} y={pct(FLOOR - h)} width={pct(width * 0.4)} height={pct(h)} />;
      })}
    </>
  );
}

/** Tonight's lanes like a Gantt instrument: a dotted texture is lane time nothing fills (a dead spot); blocks share the rows' tones. */
function Lanes({ view }: { view: StandupView }) {
  const m = view.machine;
  const top = 0.16;
  const laneH = (FLOOR + 0.06 - top) / m.lanes;
  const barH = Math.min(laneH * 0.62, 0.22);
  return (
    <>
      {Array.from({ length: m.lanes }, (_, i) => (
        <rect key={`l${i}`} className="sc-dead" x="0" y={pct(top + i * laneH)} width="100%" height={pct(barH)} />
      ))}
      {m.laneBlocks.map((b) => (
        <rect key={b.id} className={`sc-blk sc-blk--${b.tone}`} x={pct(b.start)} y={pct(top + b.lane * laneH)} width={pct(Math.max(0.004, b.end - b.start))} height={pct(barH)} rx="1" />
      ))}
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

/** The pinned first row: the machine on the same four columns as every project, its two figures set large. */
export const MachineRow = memo(function MachineRow({ view, zoom, axes, utilizationLong, loading, error, onZoom }: Props) {
  const { t } = useTranslation();
  const s = t.athena.standup.machine;
  const L = CONSOLE_COPY.machine;
  const m = view.machine;
  const hasPlan = m.laneBlocks.length > 0;
  const bars = useMemo(
    () => (zoom === 'today' ? view.machine.bars : machineBars(utilizationLong, axes.today).bars),
    [zoom, view.machine.bars, utilizationLong, axes.today],
  );
  const dead = Math.round(m.deadShare * 100);
  const span = zoom === 'today' ? CONSOLE_COPY.col.today_long : CONSOLE_COPY.col.today;
  return (
    <div className="sc-machine sc-grid" aria-label={s.label} role="group">
      <div className="sc-cell sc-c1 sc-mcell">
        <span className="sc-micro">{L.name} · {hasPlan ? fill(L.lanes, { lanes: m.lanes }) : L.summary_empty}</span>
        {hasPlan && (
          <span className="sc-mfig"><span className="sc-hero">{dead}<span className="sc-hero__unit">%</span></span><span className="sc-mfig__word">{L.idle}</span></span>
        )}
      </div>
      <Hint content={error ?? `${zoom === 'today' ? L.cpu_hint : L.cpu_hint_long} ${fill(L.zoom, { span })}`}>
        <div
          className="sc-cell sc-c2 sc-mplot sc-zoomable"
          role="button"
          tabIndex={0}
          aria-label={fill(L.zoom, { span })}
          onClick={onZoom}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onZoom(); } }}
        >
          {loading && bars.length === 0
            ? <div className="sc-mghost"><Ghost width="100%" height="2rem" /></div>
            : <Track ticks={axes.todayTicks} trackY={null}><CpuTrace bars={bars} /></Track>}
        </div>
      </Hint>
      <div className="sc-cell sc-c3 sc-mcell">
        <span className="sc-micro">{L.now}</span>
        <span className="sc-mfig"><span className="sc-hero">{clockLabel(view.nowMs)}</span><span className="sc-mfig__word">{view.status === 'armed' ? s.now_armed : s.now_draft}</span></span>
      </div>
      <Hint content={hasPlan ? fill(L.lanes_hint, { lanes: m.lanes, units: m.peakUnits, dead }) : s.night_empty}>
        <div className="sc-cell sc-c4 sc-mplot">
          <Track ticks={axes.nightTicks} nowPos={axes.nowPos} trackY={hasPlan ? null : '50%'}>{hasPlan && <Lanes view={view} />}</Track>
        </div>
      </Hint>
    </div>
  );
});
