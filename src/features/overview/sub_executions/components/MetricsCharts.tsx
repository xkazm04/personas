import {
  AreaChart, Area, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ComposedChart,
} from 'recharts';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { CHART_COLORS, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { fmtCost, fmtMs } from '../libs/executionMetricsHelpers';
import { ChartTooltipContent } from './MetricsCards';
import type { ExecutionDashboardData as ExecutionDashboard } from '@/lib/bindings/ExecutionDashboardData';

interface MetricsChartsProps {
  data: ExecutionDashboard;
  comparedChartData: Array<Record<string, string | number>>;
  personaCostData: Array<Record<string, string | number>>;
  personaNames: string[];
  chartData: Array<Record<string, string | number>>;
  anomalyDates: Set<string>;
  compareEnabled: boolean;
}

export function MetricsCharts({
  data, comparedChartData, personaCostData, personaNames,
  chartData, anomalyDates, compareEnabled,
}: MetricsChartsProps) {
  const { t, tx } = useTranslation();
  const sf = useScaledFontSize();
  return (
    <>
      {/* Cost per Day */}
      <div className="space-y-2">
        <h4 className="typo-heading text-foreground">{t.overview.execution_metrics.cost_per_day}</h4>
        <div className="h-48 2xl:h-56 bg-secondary/20 rounded-modal border border-primary/10 p-3">
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={personaCostData}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
                <XAxis dataKey="date" tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} />
                <YAxis tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: sf(10) }} />
                {personaNames.map((name, i) => (
                  <Area key={name} type="monotone" dataKey={name} stackId="1" stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.3} />
                ))}
                {chartData.filter((pt) => anomalyDates.has(String(pt.date))).map((pt) => (
                  <ReferenceLine key={pt.date} x={pt.date} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.6} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        </div>
      </div>

      {/* Execution Count by Status */}
      <div className="space-y-2">
        <h4 className="typo-heading text-foreground">{t.overview.execution_metrics.executions_by_status}</h4>
        <div className="h-40 2xl:h-52 bg-secondary/20 rounded-modal border border-primary/10 p-3">
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={comparedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
                <XAxis dataKey="date" tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} />
                <YAxis tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: sf(10) }} />
                <Bar dataKey="completed" name="Completed" stackId="status" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" name="Failed" stackId="status" fill="#ef4444" radius={[2, 2, 0, 0]} />
                {compareEnabled && <Line type="monotone" dataKey="prev_completed" name="Prev Completed" stroke="#10b981" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />}
                {compareEnabled && <Line type="monotone" dataKey="prev_failed" name="Prev Failed" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        </div>
      </div>

      {/* Success Rate Trend */}
      <div className="space-y-2">
        <h4 className="typo-heading text-foreground">{t.overview.execution_metrics.success_rate_trend}</h4>
        <div className="h-40 2xl:h-52 bg-secondary/20 rounded-modal border border-primary/10 p-3">
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
                <XAxis dataKey="date" tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} />
                <YAxis domain={[0, 100]} tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip content={<ChartTooltipContent />} />
                {compareEnabled && <Line type="monotone" dataKey="prev_successRate" name="Prev Success %" stroke="#10b981" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />}
                <Line type="monotone" dataKey="successRate" name="Success %" stroke="#10b981" strokeWidth={2} dot={false} />
                <ReferenceLine y={90} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.3} label={{ value: '90%', fill: getAxisTickFill(), fontSize: sf(9) }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        </div>
      </div>

      {/* Latency Distribution */}
      <div className="space-y-2">
        <h4 className="typo-heading text-foreground">{t.overview.execution_metrics.latency_distribution}</h4>
        <div className="h-40 2xl:h-52 bg-secondary/20 rounded-modal border border-primary/10 p-3">
          <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
                <XAxis dataKey="date" tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} />
                <YAxis tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} tickFormatter={(v: number) => fmtMs(v)} />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: sf(10) }} />
                {compareEnabled && <Line type="monotone" dataKey="prev_p50" name="Prev p50" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />}
                {compareEnabled && <Line type="monotone" dataKey="prev_p95" name="Prev p95" stroke="#f59e0b" strokeWidth={1} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />}
                <Line type="monotone" dataKey="p50" name="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p95" name="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="p99" name="p99" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
              </LineChart>
            </ResponsiveContainer>
          </ChartErrorBoundary>
        </div>
      </div>

      {/* Top Personas by Cost */}
      {data.top_personas.length > 0 && (
        <div className="space-y-2">
          <h4 className="typo-heading text-foreground">{t.overview.execution_metrics.top_personas_by_cost}</h4>
          <div className="space-y-1.5">
            {data.top_personas.map((p: { persona_id: string; persona_name: string; total_cost: number; total_executions: number; avg_cost_per_exec: number }, i: number) => {
              const maxCost = data.top_personas[0]?.total_cost || 1;
              const pct = (p.total_cost / maxCost) * 100;
              return (
                <div key={p.persona_id} className="flex items-center gap-3 px-3 py-2 rounded-modal border border-primary/10 bg-secondary/20">
                  <span className="typo-code font-mono text-foreground w-4 text-right">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="typo-heading text-foreground truncate">{p.persona_name}</span>
                      <span className="typo-code font-mono text-violet-400">{fmtCost(p.total_cost)}</span>
                    </div>
                    <div className="h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], opacity: 0.7 }} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 typo-body text-foreground">
                      <span>{tx(t.overview.execution_metrics.executions_label, { count: p.total_executions })}</span>
                      <span>~{fmtCost(p.avg_cost_per_exec)}/exec</span>
                    </div>
                  </div>
                  <ArrowUpRight className="w-3 h-3 text-foreground" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
