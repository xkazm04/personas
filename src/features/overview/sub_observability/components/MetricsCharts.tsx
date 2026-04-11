import { memo, useMemo, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, PieChart, Pie, Cell, Legend, ReferenceLine,
} from 'recharts';
import { CHART_COLORS_PURPLE, CHART_GRAD, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { MetricChart } from '@/features/overview/sub_usage/components/MetricChart';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import type { MetricsChartPoint } from '@/lib/bindings/MetricsChartPoint';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import type { ChartAnnotationRecord } from '../libs/chartAnnotations';
import { getAnnotationColor } from '../libs/chartAnnotations';

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
  /** Called when a failure bar is clicked with the date string (YYYY-MM-DD). */
  onFailureBarClick?: (date: string) => void;
  /** Called when an anomaly marker is clicked. */
  onAnomalyClick?: (anomaly: MetricAnomaly) => void;
}

export const MetricsCharts = memo(function MetricsCharts({ chartData, pieData, anomalies = [], annotations = [], onFailureBarClick, onAnomalyClick }: MetricsChartsProps) {
  const { t, tx } = useTranslation();
  const sf = useScaledFontSize();
  const { shouldAnimate } = useMotion();
  const visibleAnnotations = useMemo(() => {
    const chartDates = new Set(chartData.map((point) => point.date));
    return annotations.filter((annotation) => chartDates.has(annotation.date));
  }, [chartData, annotations]);

  const costAnomalies = useMemo(() => anomalies.filter((a) => a.metric === 'cost'), [anomalies]);

  const handleAnomalyMarkerClick = useCallback((date: string) => {
    if (!onAnomalyClick) return;
    const anomaly = costAnomalies.find((a) => a.date === date);
    if (anomaly) onAnomalyClick(anomaly);
  }, [onAnomalyClick, costAnomalies]);

  return (
    <div className="space-y-6">
      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Over Time */}
        <MetricChart title={t.overview.observability_charts.cost_over_time} height={240}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
            <XAxis dataKey="date" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
            <YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} tickFormatter={(v) => `$${v}`} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="cost" stroke="#6366f1" fill={`url(#${CHART_GRAD.cost})`} strokeWidth={2} />
            {visibleAnnotations.map((annotation, index) => (
              <ReferenceLine
                key={`cost-annotation-${annotation.date}-${annotation.type}-${index}`}
                x={annotation.date}
                stroke={getAnnotationColor(annotation.type, annotation.color)}
                strokeDasharray="4 4"
                strokeOpacity={0.65}
                label={({ viewBox }) => {
                  if (!viewBox) return null;
                  return (
                    <g>
                      <title>{`${annotation.label} * ${new Date(annotation.timestamp).toLocaleString()}`}</title>
                      <circle cx={viewBox.x} cy={viewBox.y - 6} r={2.2} fill={getAnnotationColor(annotation.type, annotation.color)} />
                    </g>
                  );
                }}
              />
            ))}
            {/* Anomaly markers — clickable pulsing diamonds */}
            {costAnomalies.map((anomaly) => (
              <ReferenceLine
                key={`anomaly-${anomaly.date}`}
                x={anomaly.date}
                stroke="#ef4444"
                strokeDasharray="2 3"
                strokeOpacity={0.5}
                label={({ viewBox }) => {
                  if (!viewBox) return null;
                  const cx = viewBox.x ?? 0;
                  const cy = (viewBox.y ?? 0) - 10;
                  return (
                    <g
                      style={{ cursor: onAnomalyClick ? 'pointer' : undefined }}
                      onClick={() => handleAnomalyMarkerClick(anomaly.date)}
                    >
                      <title>{`Anomaly: cost +${anomaly.deviation_pct.toFixed(0)}% vs baseline — click to drill down`}</title>
                      {/* Pulse ring — static when reduced motion preferred */}
                      {shouldAnimate ? (
                        <circle cx={cx} cy={cy} r={6} fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.3}>
                          <animate attributeName="r" values="4;8;4" dur="2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
                        </circle>
                      ) : (
                        <circle cx={cx} cy={cy} r={6} fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.3} />
                      )}
                      {/* Diamond marker */}
                      <polygon
                        points={`${cx},${cy - 4} ${cx + 4},${cy} ${cx},${cy + 4} ${cx - 4},${cy}`}
                        fill="#ef4444"
                        stroke="#fff"
                        strokeWidth={0.5}
                      />
                    </g>
                  );
                }}
              />
            ))}
          </AreaChart>
        </MetricChart>

        {/* Execution Distribution */}
        <MetricChart
          title={t.overview.observability_charts.executions_by_persona}
          height={240}
          emptySlot={
            pieData.length === 0 ? (
              <EmptyState variant="metrics" className="h-[240px] py-0" />
            ) : undefined
          }
        >
          <PieChart>
            <Pie data={pieData} dataKey="executions" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${String(name ?? '')} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS_PURPLE[i % CHART_COLORS_PURPLE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </MetricChart>
      </div>

      {/* Anomaly summary strip */}
      {costAnomalies.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <span className="text-xs text-amber-400/80 font-medium">
            {costAnomalies.length === 1 ? tx(t.overview.observability_charts.anomaly_detected, { count: 1 }) : tx(t.overview.observability_charts.anomalies_detected, { count: costAnomalies.length })}
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {t.overview.observability_charts.anomaly_click_hint}
          </span>
        </div>
      )}

      {/* Charts Row 2 */}
      <MetricChart title={t.overview.observability_charts.execution_health} height={240}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
          <XAxis dataKey="date" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
          <YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
          <Tooltip content={<ChartTooltip />} cursor={false} />
          <Legend wrapperStyle={{ fontSize: sf(11) }} />
          <Bar dataKey="success" name={t.overview.observability_charts.successful} fill="#22c55e" radius={[2, 2, 0, 0]} />
          <Bar
            dataKey="failed"
            name={t.overview.observability_charts.failed}
            fill="#ef4444"
            radius={[2, 2, 0, 0]}
            cursor={onFailureBarClick ? 'pointer' : undefined}
            onClick={onFailureBarClick ? (data: { payload?: MetricsChartPoint }) => {
              if (data.payload?.date && data.payload.failed > 0) onFailureBarClick(data.payload.date);
            } : undefined}
          />
          {visibleAnnotations.map((annotation, index) => (
            <ReferenceLine
              key={`health-annotation-${annotation.date}-${annotation.type}-${index}`}
              x={annotation.date}
              stroke={getAnnotationColor(annotation.type, annotation.color)}
              strokeDasharray="4 4"
              strokeOpacity={0.65}
              label={({ viewBox }) => {
                if (!viewBox) return null;
                return (
                  <g>
                    <title>{`${annotation.label} * ${new Date(annotation.timestamp).toLocaleString()}`}</title>
                    <circle cx={viewBox.x} cy={viewBox.y - 6} r={2.2} fill={getAnnotationColor(annotation.type, annotation.color)} />
                  </g>
                );
              }}
            />
          ))}
        </BarChart>
      </MetricChart>
    </div>
  );
});
