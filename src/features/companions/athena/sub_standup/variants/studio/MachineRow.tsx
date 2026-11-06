import { memo, useMemo } from 'react';
import { Cpu } from 'lucide-react';

import { Ghost, Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Zoom } from '../../model/keymap';
import { machineBars } from '../../model/machine';
import { clockLabel } from '../../model/timeAxis';
import type { MachineBar, StandupView } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { Track, type Axes } from './axis';
import { fill, STUDIO_COPY } from './copy';

/** Measured host CPU per bin: rounded columns with a soft gradient; green where an agent ran, a hatched floor where nothing was recorded. */
function CpuBars({ bars }: { bars: MachineBar[] }) {
  const width = bars[0]?.width ?? 1 / 36;
  const present = new Set(bars.map((b) => Math.round(b.pos * 1000)));
  const gaps: number[] = [];
  for (let p = 0; p < 1 - 1e-6; p += width) if (!present.has(Math.round(p * 1000))) gaps.push(p);
  return (
    <div className="ss-bars">
      {gaps.map((p) => <i key={`g${p}`} className="ss-gap" style={{ left: pct(p + width * 0.1), width: pct(width * 0.8) }} />)}
      {bars.map((b) => (
        <i
          key={b.pos}
          className={b.busy ? 'ss-bar is-busy' : 'ss-bar'}
          style={{ left: pct(b.pos + width * 0.14), width: pct(width * 0.72), height: pct(Math.max(0.06, b.cpu)) }}
        />
      ))}
    </div>
  );
}

/** Tonight's lanes as rounded tracks: the warm tint is lane time nothing fills (a dead spot); blocks share the rows' tones. */
function Lanes({ view }: { view: StandupView }) {
  const m = view.machine;
  return (
    <div className="ss-lanes">
      {Array.from({ length: m.lanes }, (_, i) => (
        <div key={i} className="ss-mlane">
          {m.laneBlocks.filter((b) => b.lane === i).map((b) => (
            <i key={b.id} className={`ss-blk ss-blk--${b.tone}`} style={{ left: pct(b.start), width: pct(Math.max(0.006, b.end - b.start)) }} />
          ))}
        </div>
      ))}
    </div>
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

/** The pinned first row: the machine on the same four columns as every project, on its own raised surface. */
export const MachineRow = memo(function MachineRow({ view, zoom, axes, utilizationLong, loading, error, onZoom }: Props) {
  const { t } = useTranslation();
  const s = t.athena.standup.machine;
  const L = STUDIO_COPY.machine;
  const m = view.machine;
  const hasPlan = m.laneBlocks.length > 0;
  const bars = useMemo(
    () => (zoom === 'today' ? view.machine.bars : machineBars(utilizationLong, axes.today).bars),
    [zoom, view.machine.bars, utilizationLong, axes.today],
  );
  const dead = Math.round(m.deadShare * 100);
  const zoomLabel = fill(L.zoom, { span: zoom === 'today' ? STUDIO_COPY.col.today_long : STUDIO_COPY.col.today });
  return (
    <div className="ss-machine ss-grid" aria-label={s.label} role="group">
      <div className="ss-cell ss-c1 ss-mname">
        <span className="ss-mname__t"><Cpu className="ss-ico" aria-hidden="true" />{L.name}</span>
        <span className="ss-sub">{hasPlan ? fill(L.summary, { lanes: m.lanes, dead }) : L.summary_empty}</span>
      </div>
      <Hint content={error ?? `${zoom === 'today' ? L.cpu_hint : L.cpu_hint_long} ${zoomLabel}`}>
        <div
          className="ss-cell ss-c2 ss-mfig ss-zoomable focus-ring"
          role="button"
          tabIndex={0}
          aria-label={zoomLabel}
          onClick={onZoom}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onZoom(); } }}
        >
          {loading && bars.length === 0
            ? <div className="ss-mghost"><Ghost width="100%" height="2rem" /></div>
            : <Track ticks={axes.todayTicks}><CpuBars bars={bars} /></Track>}
        </div>
      </Hint>
      <div className="ss-cell ss-c3 ss-mnow">
        <span className={`ss-clock ${view.status === 'armed' ? 'is-live' : ''}`}>{clockLabel(view.nowMs)}</span>
        <span className="ss-sub">{view.status === 'armed' ? s.now_armed : s.now_draft}</span>
      </div>
      <Hint content={hasPlan ? fill(L.lanes_hint, { lanes: m.lanes, units: m.peakUnits, dead }) : s.night_empty}>
        <div className="ss-cell ss-c4 ss-mfig">
          <Track ticks={axes.nightTicks} nowPos={axes.nowPos} lane={!hasPlan}>{hasPlan && <Lanes view={view} />}</Track>
        </div>
      </Hint>
    </div>
  );
});
