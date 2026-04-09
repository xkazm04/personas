import { memo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  ComposedChart,
} from 'recharts';
import { MetricChart } from '@/features/overview/sub_usage/components/MetricChart';
import { LazyChart } from '@/features/overview/sub_usage/components/LazyChart';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { CHART_COLORS, CHART_COLORS_PURPLE, CHART_GRAD, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { DASHBOARD_GRID } from '@/features/overview/utils/dashboardGrid';
import { dashboardContainer, dashboardItem } from '@/features/templates/animationPresets';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { formatToolName } from '../libs/analyticsHelpers';
import type { PieDataPoint } from '@/features/overview/sub_observability/components/MetricsCharts';
import type { MetricsChartPoint } from '@/lib/bindings/MetricsChartPoint';

interface AnalyticsChartsProps {
  chartData: Array<Record<string, unknown>>;
  compareEnabled: boolean;
  areaData: Array<Record<string, unknown>>;
  allToolNames: string[];
  pieData: PieDataPoint[];
  latencyData: Array<{ date: string; p50: number; p95: number; p99: number }>;
  barData: Array<{ name: string; invocations: number; executions: number; personas: number }>;
  handleFailureBarClick: (data: { date?: string; failed?: number }) => void;
}

export const AnalyticsCharts = memo(function AnalyticsCharts({
  chartData, compareEnabled, areaData, allToolNames,
  pieData, latencyData, barData, handleFailureBarClick,
}: AnalyticsChartsProps) {
  const sf = useScaledFontSize();
  const { shouldAnimate } = useMotion();
  return (
    <>
      {/* Charts -- 2 column grid */}
      <motion.div
        className={DASHBOARD_GRID}
        variants={shouldAnimate ? dashboardContainer : undefined}
        initial={shouldAnimate ? "hidden" : false}
        animate="show"
      >
        {/* Cost Over Time */}
        <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
        <MetricChart title="Cost Over Time" height={180}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
            <XAxis dataKey="dateLabel" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
            <YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} tickFormatter={(v) => `$${v}`} />
            <Tooltip content={<ChartTooltip />} />
            {compareEnabled && (
              <Area type="monotone" dataKey="prev_cost" name="Prev Cost" stroke="#6366f1" fill="none" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.35} dot={false} />
            )}
            <Area type="monotone" dataKey="cost" stroke="#6366f1" fill={`url(#${CHART_GRAD.cost})`} strokeWidth={2} />
          </AreaChart>
        </MetricChart>
        </motion.div>

        {/* Execution Health */}
        <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
        <MetricChart title="Execution Health" height={180}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
            <XAxis dataKey="dateLabel" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
            <YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
            <Tooltip content={<ChartTooltip />} cursor={false} />
            <Legend wrapperStyle={{ fontSize: sf(11) }} />
            <Bar dataKey="success" name="Successful" fill="#22c55e" radius={[2, 2, 0, 0]} />
            <Bar
              dataKey="failed"
              name="Failed"
              fill="#ef4444"
              radius={[2, 2, 0, 0]}
              cursor="pointer"
              onClick={(data: { payload?: MetricsChartPoint }) => {
                if (data.payload) handleFailureBarClick(data.payload);
              }}
            />
            {compareEnabled && (
              <Line type="monotone" dataKey="prev_success" name="Prev Successful" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />
            )}
            {compareEnabled && (
              <Line type="monotone" dataKey="prev_failed" name="Prev Failed" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.4} dot={false} />
            )}
          </ComposedChart>
        </MetricChart>
        </motion.div>

        {/* Tool Usage Over Time */}
        {areaData.length > 0 && (
          <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
          <LazyChart height={180}>
            <MetricChart title="Tool Usage Over Time" height={180}>
              <AreaChart data={areaData} margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
                <XAxis dataKey="dateLabel" tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} />
                <YAxis tick={{ fill: getAxisTickFill(), fontSize: sf(10) }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                {allToolNames.map((toolName, idx) => (
                  <Area key={toolName} type="monotone" dataKey={toolName} name={formatToolName(toolName)} stackId="1" fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.3} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={1.5} />
                ))}
              </AreaChart>
            </MetricChart>
          </LazyChart>
          </motion.div>
        )}

        {/* Executions by Persona (donut) */}
        <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
        <LazyChart height={180}>
          <MetricChart
            title="Executions by Persona"
            height={180}
            emptySlot={pieData.length === 0 ? (
              <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground/80">No execution data</div>
            ) : undefined}
          >
            <PieChart>
              <Pie data={pieData} dataKey="executions" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} stroke="none">
                {pieData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS_PURPLE[i % CHART_COLORS_PURPLE.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} formatter={(value: string) => (
                <span className="text-sm text-foreground/90">{value}</span>
              )} />
            </PieChart>
          </MetricChart>
        </LazyChart>
        </motion.div>

        {/* Latency Distribution */}
        {latencyData.length > 0 && (
          <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
          <LazyChart height={180}>
            <MetricChart title="Latency (p50 / p95 / p99)" height={180}>
              <LineChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
                <XAxis dataKey="dateLabel" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
                <YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: sf(10) }} />
                <Line type="monotone" dataKey="p50" name="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p95" name="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="p99" name="p99" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
              </LineChart>
            </MetricChart>
          </LazyChart>
          </motion.div>
        )}
      </motion.div>

      {/* Tool Invocations -- full width horizontal bar */}
      {barData.length > 0 && (
        <motion.div
          initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.25 }}
        >
        <LazyChart height={Math.max(200, barData.length * 40)}>
          <MetricChart title="Tool Invocations" height={Math.max(200, barData.length * 40)}>
            <BarChart data={barData} margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} horizontal={false} />
              <XAxis type="number" tick={{ fill: getAxisTickFill(), fontSize: sf(11) }} axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" width={120} tick={{ fill: getAxisTickFill(), fontSize: sf(11) }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="invocations" name="Invocations" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </MetricChart>
        </LazyChart>
        </motion.div>
      )}
    </>
  );
});
