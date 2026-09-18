// The KPIs past the twelfth panel. They keep the SAME window and the same
// [-15, 115] band as the panels above — a compact row is a smaller drawing of
// the same fact, never a differently-scaled one. Under three readings: dots.
import { useTranslation } from '@/i18n/useTranslation';

import { TRACK_COLOR } from '../kpiMeta';
import { bandFill, SIMULATED_DASH } from '../kpiChartTheme';
import type { KpiTrack } from '../kpiMath';
import type { TimeWindow } from '../kpiSample';
import { sparkCoords, type PanelSeries } from './KpiGroupLayer.model';

const W = 96;
const H = 24;

function trackLabel(track: KpiTrack, t: ReturnType<typeof useTranslation>['t']): string {
  switch (track) {
    case 'met':
      return t.kpis.track_met;
    case 'on-track':
      return t.kpis.track_on;
    case 'off-track':
      return t.kpis.track_off;
    case 'unpaced':
      return t.kpis.track_unpaced;
    default:
      return t.kpis.track_unmeasured;
  }
}

export function KpiOverflowTable({
  title,
  series,
  window,
  onOpen,
}: {
  title: string;
  series: PanelSeries[];
  window: TimeWindow;
  onOpen: (kpiId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5" data-testid="kpi-layer-overflow">
      {/* muted-ok: section micro-label over the overflow rows, not body text */}
      <h4 className="typo-label text-muted-foreground">{title}</h4>
      <ul className="divide-y divide-border/40">
        {series.map((s) => (
          <li key={s.kpi.id} className="flex items-center gap-2 py-1.5">
            <button
              type="button"
              onClick={() => onOpen(s.kpi.id)}
              aria-label={s.kpi.name}
              className="typo-caption text-foreground truncate flex-1 min-w-0 text-left hover:text-primary focus-ring rounded-interactive"
            >
              {s.kpi.name}
            </button>
            <span
              className="rounded-pill px-2 py-0.5 typo-label text-foreground shrink-0"
              style={{ background: bandFill(TRACK_COLOR[s.track], 1) }}
            >
              {trackLabel(s.track, t)}
            </span>
            <Sparkline series={s} window={window} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sparkline({ series, window }: { series: PanelSeries; window: TimeWindow }) {
  const pts = sparkCoords(series.points, window, W, H);
  const color = TRACK_COLOR[series.track];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden="true">
      {pts.length >= 3 && (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={series.simulated ? SIMULATED_DASH : undefined}
        />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.5} fill={color} />
      ))}
    </svg>
  );
}
