/**
 * Observability (composition kit): the trend charts. Each chart is a Section whose plot is a
 * ChartFrame on the reading line; series colours are kit tones (toneColor), so cost reads in
 * the theme's primary, success and failure in the status tones a Mark uses, and the legend is
 * the kit's Dot row in the section meta instead of recharts' own. The per-persona split is a
 * DataTable (PersonaBreakdownTable): its names were clipped as pie labels.
 */
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { LazyChart, type RechartsModule } from '@/features/shared/charts/RechartsWrapper';
import { ChartFrame, Dot, Section, toneColor } from '@/features/shared/components/kit';
import type { MetricsChartPoint } from '@/lib/bindings/MetricsChartPoint';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import type { ChartAnnotationRecord } from '../libs/chartAnnotations';
import { renderAnnotationLines, renderAnomalyMarkers } from './chartMarkers';
import { PersonaBreakdownTable } from './PersonaBreakdownTable';

// Stable tooltip element: Recharts compares prop identity.
const TOOLTIP_CONTENT = <ChartTooltip />;
const PLOT_MARGIN = { top: 16, right: 8, bottom: 0, left: 0 };
const HEIGHT = 220;

export interface PieDataPoint {
  name: string;
  executions: number;
  cost: number;
}

export interface MetricsChartsProps {
  chartData: MetricsChartPoint[];
  pieData: PieDataPoint[];
  anomalies?: MetricAnomaly[];
  annotations?: ChartAnnotationRecord[];
  loading?: boolean;
  /** Called when a failure bar is clicked with the date string (YYYY-MM-DD). */
  onFailureBarClick?: (date: string) => void;
  /** Called when an anomaly marker is clicked. */
  onAnomalyClick?: (anomaly: MetricAnomaly) => void;
}

function Plot({ render, resetKey }: { render: (R: RechartsModule) => ReactElement; resetKey: string }) {
  return (
    // New data remounts the boundary, so a chart that failed on one window renders the next.
    <ChartErrorBoundary key={resetKey}>
      <LazyChart
        fallback={<div style={{ height: HEIGHT }} />}
        render={(R) => <R.ResponsiveContainer width="100%" height={HEIGHT}>{render(R)}</R.ResponsiveContainer>}
      />
    </ChartErrorBoundary>
  );
}

export const MetricsCharts = memo(function MetricsCharts({ chartData, pieData, anomalies = [], annotations = [], loading, onFailureBarClick, onAnomalyClick }: MetricsChartsProps) {
  const { t, tx, language } = useTranslation();
  const c = t.overview.observability_charts;
  const sf = useScaledFontSize();
  const { shouldAnimate } = useMotion();
  const dateTick = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
    return (v: string) => fmt.format(new Date(v));
  }, [language]);
  const costTick = useMemo(() => {
    const fmt = new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    return (v: number) => fmt.format(v);
  }, [language]);
  const visible = useMemo(() => {
    const dates = new Set(chartData.map((p) => p.date));
    return annotations.filter((a) => dates.has(a.date));
  }, [chartData, annotations]);
  const costAnomalies = useMemo(() => anomalies.filter((a) => a.metric === 'cost'), [anomalies]);
  const anomalyLabel = useCallback((a: MetricAnomaly) => {
    const x = t.overview.anomaly_drilldown_extra;
    const usd = new Intl.NumberFormat(language, { style: 'currency', currency: 'USD' });
    return `${x.title} · ${x.value_label} ${usd.format(a.value)} · ${x.baseline_label} ${usd.format(a.baseline)}`;
  }, [t, language]);
  const onMarker = useCallback((date: string) => {
    const a = costAnomalies.find((x) => x.date === date);
    if (a && onAnomalyClick) onAnomalyClick(a);
  }, [onAnomalyClick, costAnomalies]);

  const tick = useMemo(() => ({ fontSize: sf(10), fill: getAxisTickFill() }), [sf]);
  const grid = getGridStroke();
  const resetKey = `${chartData.length}:${chartData[0]?.date ?? ''}:${chartData[chartData.length - 1]?.date ?? ''}`;
  const state = loading ? 'loading' : chartData.length === 0 ? 'empty' : undefined;
  const empty = { title: t.overview.analytics_dashboard.no_execution_data };
  const anomalyMeta = costAnomalies.length > 0 ? (
    <span className="k-legend-row typo-caption">
      <span><Dot tone="error" />{tx(costAnomalies.length === 1 ? c.anomaly_detected : c.anomalies_detected, { count: costAnomalies.length })}</span>
      <span>{c.anomaly_click_hint}</span>
    </span>
  ) : undefined;

  return (
    <>
      <Section id="s-obs-cost" title={c.cost_over_time} meta={anomalyMeta}>
        <ChartFrame height={HEIGHT} label={c.cost_over_time} state={state} empty={empty}>
          <Plot resetKey={resetKey} render={(R) => (
            <R.AreaChart data={chartData} margin={PLOT_MARGIN}>
              <R.CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <R.XAxis dataKey="date" tick={tick} tickFormatter={dateTick} />
              <R.YAxis tick={tick} tickFormatter={costTick} width={48} />
              <R.Tooltip content={TOOLTIP_CONTENT} />
              <R.Area type="monotone" dataKey="cost" stroke={toneColor('primary')} fill={toneColor('primary')} fillOpacity={0.12} strokeWidth={2} />
              {renderAnnotationLines(R, visible, 'cost')}
              {renderAnomalyMarkers(R, costAnomalies, { animate: shouldAnimate, onClick: onAnomalyClick ? onMarker : undefined, label: anomalyLabel })}
            </R.AreaChart>
          )} />
        </ChartFrame>
      </Section>
      <Section
        id="s-obs-health-chart"
        title={c.execution_health}
        meta={
          <span className="k-legend-row typo-caption">
            <span><Dot tone="success" />{c.successful}</span>
            <span><Dot tone="error" />{c.failed}</span>
          </span>
        }
      >
        <ChartFrame height={HEIGHT} label={c.execution_health} state={state} empty={empty}>
          <Plot resetKey={resetKey} render={(R) => (
            <R.BarChart data={chartData} margin={PLOT_MARGIN}>
              <R.CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <R.XAxis dataKey="date" tick={tick} tickFormatter={dateTick} />
              <R.YAxis tick={tick} width={48} />
              <R.Tooltip content={TOOLTIP_CONTENT} cursor={false} />
              <R.Bar dataKey="success" name={c.successful} fill={toneColor('success')} radius={[2, 2, 0, 0]} />
              <R.Bar
                dataKey="failed"
                name={c.failed}
                fill={toneColor('error')}
                radius={[2, 2, 0, 0]}
                cursor={onFailureBarClick ? 'pointer' : undefined}
                onClick={onFailureBarClick ? (data: { payload?: MetricsChartPoint }) => {
                  if (data.payload?.date && data.payload.failed > 0) onFailureBarClick(data.payload.date);
                } : undefined}
              />
              {renderAnnotationLines(R, visible, 'health')}
            </R.BarChart>
          )} />
        </ChartFrame>
      </Section>
      <PersonaBreakdownTable rows={pieData} loading={loading} />
    </>
  );
});
