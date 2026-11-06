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
import { fill, LEDGER_COPY } from './copy';

const FLOOR = 0.92;
const TALL = 0.78;

/** Measured host CPU per bin on the Today axis; green where an agent ran, hatched where nothing was recorded. */
function CpuBars({ bars }: { bars: MachineBar[] }) {
  const width = bars[0]?.width ?? 1 / 36;
  const present = new Set(bars.map((b) => Math.round(b.pos * 1000)));
  const gaps: number[] = [];
  for (let p = 0; p < 1 - 1e-6; p += width) if (!present.has(Math.round(p * 1000))) gaps.push(p);
  return (
    <>
      {gaps.map((p) => <rect key={`g${p}`} className="sl-gap" x={pct(p)} y={pct(FLOOR - 0.18)} width={pct(width)} height={pct(0.18)} />)}
      {bars.map((b) => {
        const h = Math.max(0.04, b.cpu) * TALL;
        return <rect key={b.pos} className={b.busy ? 'sl-bar is-busy' : 'sl-bar'} x={pct(b.pos + width * 0.12)} y={pct(FLOOR - h)} width={pct(width * 0.76)} height={pct(h)} rx="1" />;
      })}
    </>
  );
}

/** Tonight's lanes: amber is lane time nothing fills (a dead spot); blocks share the rows' tones. */
function Lanes({ view }: { view: StandupView }) {
  const m = view.machine;
  const top = 0.14;
  const laneH = (FLOOR - top) / m.lanes;
  return (
    <>
      {Array.from({ length: m.lanes }, (_, i) => (
        <rect key={`l${i}`} className="sl-dead" x="0" y={pct(top + i * laneH)} width="100%" height={pct(laneH * 0.8)} rx="2" />
      ))}
      {m.laneBlocks.map((b) => (
        <rect key={b.id} className={`sl-blk sl-blk--${b.tone}`} x={pct(b.start)} y={pct(top + b.lane * laneH)} width={pct(Math.max(0.004, b.end - b.start))} height={pct(laneH * 0.8)} rx="2" />
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

/** The pinned first row: the machine on the same four columns as every project. */
export const MachineRow = memo(function MachineRow({ view, zoom, axes, utilizationLong, loading, error, onZoom }: Props) {
  const { t } = useTranslation();
  const s = t.athena.standup.machine;
  const L = LEDGER_COPY.machine;
  const m = view.machine;
  const hasPlan = m.laneBlocks.length > 0;
  const bars = useMemo(
    () => (zoom === 'today' ? view.machine.bars : machineBars(utilizationLong, axes.today).bars),
    [zoom, view.machine.bars, utilizationLong, axes.today],
  );
  const dead = Math.round(m.deadShare * 100);
  return (
    <div className="sl-machine sl-grid" aria-label={s.label} role="group">
      <div className="sl-cell sl-c1 sl-mname">
        <span className="typo-body k-strong text-foreground">{L.name}</span>
        <span className="typo-caption">{hasPlan ? fill(L.summary, { lanes: m.lanes, dead }) : L.summary_empty}</span>
      </div>
      <Hint content={error ?? `${zoom === 'today' ? L.cpu_hint : L.cpu_hint_long} ${fill(L.zoom, { span: zoom === 'today' ? LEDGER_COPY.col.today_long : LEDGER_COPY.col.today })}`}>
        <div
          className="sl-cell sl-c2 sl-mfig sl-zoomable focus-ring"
          role="button"
          tabIndex={0}
          aria-label={fill(L.zoom, { span: zoom === 'today' ? LEDGER_COPY.col.today_long : LEDGER_COPY.col.today })}
          onClick={onZoom}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onZoom(); } }}
        >
          {loading && bars.length === 0
            ? <div className="sl-mghost"><Ghost width="100%" height="2rem" /></div>
            : <Track ticks={axes.todayTicks} trackY={null}><CpuBars bars={bars} /></Track>}
        </div>
      </Hint>
      <div className="sl-cell sl-c3 sl-mnow">
        <span className="typo-data k-strong text-foreground">{clockLabel(view.nowMs)}</span>
        <span className="typo-caption">{view.status === 'armed' ? s.now_armed : s.now_draft}</span>
      </div>
      <Hint content={hasPlan ? fill(L.lanes_hint, { lanes: m.lanes, units: m.peakUnits, dead }) : s.night_empty}>
        <div className="sl-cell sl-c4 sl-mfig">
          <Track ticks={axes.nightTicks} nowPos={axes.nowPos} trackY={hasPlan ? null : '50%'}>{hasPlan && <Lanes view={view} />}</Track>
        </div>
      </Hint>
    </div>
  );
});
