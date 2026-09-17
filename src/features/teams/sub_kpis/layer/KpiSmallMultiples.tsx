// Progress toward target — up to 12 mini panels on ONE shared time window and
// ONE shared 0–100 %-of-target scale, so sibling charts are comparable at a
// glance. A series with fewer than 3 readings is drawn as dots (a line would
// claim a trend we cannot see); a simulated/composed series is dashed. A
// failed read is stated as a failure with a Retry, never as empty axes.
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { useTranslation } from '@/i18n/useTranslation';

import { AXIS_PROPS, GRID_PROPS, SIMULATED_DASH, TARGET_LINE_PROPS, TOOLTIP_STYLE } from '../kpiChartTheme';
import { TRACK_COLOR } from '../kpiMeta';
import type { TimeWindow } from '../kpiSample';
import type { LazyTrendsStatus } from '../useKpiOverview';
import { MAX_PANELS, type PanelSeries } from './KpiGroupLayer.model';
import { KpiOverflowTable } from './KpiOverflowTable';

const GHOST = 'h-24 rounded-card bg-primary/[0.06] animate-fade-in';
const PANEL = 'rounded-card border border-primary/15 bg-secondary/10 p-2 [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none [&_svg]:outline-none';
const GRID = 'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3';

export function KpiSmallMultiples({
  series,
  window,
  status,
  onRetry,
  onOpen,
}: {
  series: PanelSeries[];
  window: TimeWindow | null;
  status: LazyTrendsStatus;
  onRetry: () => void;
  onOpen: (kpiId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const panels = series.slice(0, MAX_PANELS);
  const overflow = series.slice(MAX_PANELS);

  return (
    <section className="rounded-card border border-primary/15 bg-secondary/10 p-4 space-y-3" data-testid="kpi-layer-multiples">
      <div>
        <h3 className="typo-overline text-foreground">{o.layer_multiples_title}</h3>
        <p className="typo-caption">{o.layer_multiples_caption}</p>
      </div>

      {status === 'failed' ? (
        <div className="space-y-2">
          <p className="typo-caption">{o.trends_failed}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-interactive border border-primary/25 bg-secondary/30 px-2.5 py-1 typo-label text-foreground hover:bg-secondary/50 focus-ring"
          >
            {o.retry}
          </button>
        </div>
      ) : series.length === 0 ? (
        status === 'loading' ? (
          <div className={GRID} aria-hidden="true" data-testid="kpi-layer-multiples-ghost">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={GHOST} style={{ animationDelay: `${150 + i * 35}ms` }} />
            ))}
          </div>
        ) : (
          <p className="typo-caption">{o.layer_no_series}</p>
        )
      ) : (
        <>
          <div className={GRID}>
            {panels.map((s) => (
              <MiniPanel key={s.kpi.id} series={s} window={window} onOpen={onOpen} />
            ))}
          </div>
          {overflow.length > 0 && window && (
            <KpiOverflowTable
              title={tx(o.layer_more_title, { count: overflow.length })}
              series={overflow}
              window={window}
              onOpen={onOpen}
            />
          )}
        </>
      )}
    </section>
  );
}

function MiniPanel({
  series,
  window,
  onOpen,
}: {
  series: PanelSeries;
  window: TimeWindow | null;
  onOpen: (kpiId: string) => void;
}) {
  const { t } = useTranslation();
  const { kpi, track, points, simulated } = series;
  const color = TRACK_COLOR[track];
  const tooFew = points.length < 3;
  return (
    <div className={PANEL} data-testid="kpi-layer-panel">
      <button
        type="button"
        onClick={() => onOpen(kpi.id)}
        aria-label={kpi.name}
        className="typo-label text-foreground truncate max-w-full text-left hover:text-primary focus-ring rounded-interactive"
      >
        {kpi.name}
      </button>
      <LazyChart
        fallback={<div className={GHOST} style={{ animationDelay: '150ms' }} aria-hidden="true" />}
        render={(R) => (
          <R.ResponsiveContainer width="100%" height={96}>
            <R.LineChart accessibilityLayer={false} data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <R.CartesianGrid {...GRID_PROPS} />
              <R.XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={window ? [window.from, window.to] : ['dataMin', 'dataMax']}
                tickFormatter={(ts: number) => new Date(ts).toLocaleDateString()}
                minTickGap={28}
                {...AXIS_PROPS}
              />
              <R.YAxis domain={[-15, 115]} hide />
              <R.ReferenceLine {...TARGET_LINE_PROPS} />
              <R.Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={((ts: unknown) => new Date(Number(ts)).toLocaleDateString()) as never}
                formatter={((v: unknown) => `${Number(v)}%`) as never}
              />
              <R.Line
                dataKey="v"
                type="monotone"
                stroke={tooFew ? 'none' : color}
                strokeWidth={2}
                strokeDasharray={simulated ? SIMULATED_DASH : undefined}
                dot={{ r: 2.5, fill: color, stroke: color }}
                isAnimationActive={false}
              />
            </R.LineChart>
          </R.ResponsiveContainer>
        )}
      />
      {tooFew && <p className="typo-caption">{t.kpis.overview.layer_too_few}</p>}
    </div>
  );
}
