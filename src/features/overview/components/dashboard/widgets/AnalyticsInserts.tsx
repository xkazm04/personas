import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  Bar, ComposedChart,
} from 'recharts';
import { MetricChart } from '@/features/overview/sub_usage/components/MetricChart';
import { ChartTooltip } from '@/features/overview/sub_usage/components/ChartTooltip';
import { CHART_GRAD, getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import { useScaledFontSize } from '@/stores/themeStore';
import { useChartSeries } from '@/features/overview/sub_analytics/libs/useChartSeries';
import { useHealingWorkflow } from '@/features/overview/sub_analytics/libs/useHealingWorkflow';
import { RotationOverviewPanel } from '@/features/overview/sub_analytics/components/RotationOverviewPanel';
import { HealthIssuesPanel } from '@/features/overview/sub_analytics/components/HealthIssuesPanel';

/**
 * Lazy-loaded analytics inserts for DashboardHome.
 * Keeps recharts out of the eager bundle.
 */
const AnalyticsInserts = memo(function AnalyticsInserts({ position }: { position: 'center' | 'right' }) {
  if (position === 'center') return <CenterCharts />;
  return <RightPanels />;
});

export default AnalyticsInserts;

function CenterCharts() {
  const { t } = useTranslation();
  const { chartData } = useChartSeries();
  const sf = useScaledFontSize();

  return (
    <>
      {/* Execution Health */}
      <MetricChart title={t.overview.widgets_extra.execution_health_chart} height={160}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
          <XAxis dataKey="dateLabel" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
          <YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
          <Tooltip content={<ChartTooltip />} cursor={false} />
          <Legend wrapperStyle={{ fontSize: sf(11) }} />
          <Bar dataKey="success" name={t.overview.widgets_extra.successful} fill="#22c55e" radius={[2, 2, 0, 0]} />
          <Bar dataKey="failed" name={t.overview.widgets_extra.failed} fill="#ef4444" radius={[2, 2, 0, 0]} />
        </ComposedChart>
      </MetricChart>

      {/* Cost Over Time */}
      <MetricChart title={t.overview.widgets_extra.cost_over_time_chart} height={160}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} />
          <XAxis dataKey="dateLabel" tick={{ fontSize: sf(10), fill: getAxisTickFill() }} />
          <YAxis tick={{ fontSize: sf(10), fill: getAxisTickFill() }} tickFormatter={(v) => `$${v}`} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="cost" stroke="#6366f1" fill={`url(#${CHART_GRAD.cost})`} strokeWidth={2} />
        </AreaChart>
      </MetricChart>
    </>
  );
}

function RightPanels() {
  const healing = useHealingWorkflow();

  return (
    <>
      <RotationOverviewPanel />
      <HealthIssuesPanel
        healingIssues={healing.healingIssues}
        healingRunning={healing.healingRunning}
        sortedFilteredIssues={healing.sortedFilteredIssues}
        issueFilter={healing.issueFilter}
        setIssueFilter={healing.setIssueFilter}
        issueCounts={healing.issueCounts}
        analysisResult={healing.analysisResult}
        analysisError={healing.analysisError}
        setAnalysisResult={healing.setAnalysisResult}
        setAnalysisError={healing.setAnalysisError}
        handleRunAnalysis={healing.handleRunAnalysis}
        resolveHealingIssue={healing.resolveHealingIssue}
        onSelectIssue={healing.setSelectedIssue}
      />
    </>
  );
}
