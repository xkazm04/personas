import { useTranslation } from '@/i18n/useTranslation';
import { RefreshCw, BarChart3, AlertTriangle } from 'lucide-react';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import HealingIssueModal from '@/features/overview/sub_observability/components/HealingIssueModal';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewMetrics } from '../libs/useOverviewMetrics';
import { useChartSeries } from '../libs/useChartSeries';
import { useHealingWorkflow } from '../libs/useHealingWorkflow';
import { AnalyticsSummaryCards } from './AnalyticsSummaryCards';
import { AnalyticsFilters } from './AnalyticsFilters';
import { AnalyticsCharts } from './AnalyticsCharts';
import { HealthIssuesPanel } from './HealthIssuesPanel';
import { RotationOverviewPanel } from './RotationOverviewPanel';

export default function AnalyticsDashboard() {
  const { t, tx } = useTranslation();
  const metrics = useOverviewMetrics();
  const charts = useChartSeries();
  const healing = useHealingWorkflow();
  const {
    dayRange: days,
    setDayRange: setDays,
    selectedPersonaId,
    setSelectedPersonaId,
    customDateRange,
    setCustomDateRange,
    compareEnabled,
    setCompareEnabled,
  } = useOverviewFilters();
  const personas = useAgentStore((s) => s.personas);

  return (
    <ContentBox>
      <ContentHeader
        icon={<BarChart3 className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.overview.analytics_dashboard.title}
        subtitle={t.overview.analytics_dashboard.subtitle}
        actions={
          <div className="flex items-center gap-2 flex-shrink-0">
            <AnalyticsSummaryCards
              totalCost={metrics.summary?.totalCostUsd || 0}
              totalExecutions={metrics.summary?.totalExecutions || 0}
              successRate={metrics.successRate}
              activePersonas={metrics.summary?.activePersonas || 0}
            />
            <button
              onClick={() => { void metrics.refreshAllSafe(); }}
              className="p-1.5 rounded-card text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title={t.common.refresh}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => metrics.setAutoRefresh(!metrics.autoRefresh)}
              className={`p-1.5 rounded-card border transition-colors ${
                metrics.autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/90'
              }`}
              title={metrics.autoRefresh ? t.overview.analytics_dashboard.auto_refresh_on : t.overview.analytics_dashboard.auto_refresh_off}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${metrics.autoRefresh ? 'animate-spin' : ''}`} style={metrics.autoRefresh ? { animationDuration: '3s' } : {}} />
            </button>
          </div>
        }
      />

      <AnalyticsFilters
        selectedPersonaId={selectedPersonaId}
        setSelectedPersonaId={setSelectedPersonaId}
        days={days}
        setDays={setDays}
        customDateRange={customDateRange}
        setCustomDateRange={setCustomDateRange}
        compareEnabled={compareEnabled}
        setCompareEnabled={setCompareEnabled}
        personas={personas}
      />

      <ContentBody>
        <div className="space-y-5">
          {/* Error banner */}
          {metrics.observabilityError && (
            <InlineErrorBanner
              severity="error"
              title={t.overview.analytics_dashboard.metrics_unavailable}
              message={metrics.observabilityError}
              onRetry={() => { void metrics.refreshAllSafe(); }}
            />
          )}

          {/* Cost anomaly alerts */}
          {metrics.costAnomalies.length > 0 && (
            <div className="rounded-modal border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    {metrics.costAnomalies.length === 1 ? tx(t.overview.analytics_dashboard.cost_anomaly_detected, { count: 1 }) : tx(t.overview.analytics_dashboard.cost_anomalies_detected, { count: metrics.costAnomalies.length })}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {metrics.costAnomalies.map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-modal text-sm border bg-amber-500/15 text-amber-300 border-amber-500/25">
                        {new Date(a.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        <span className="font-mono text-sm opacity-80">${a.cost.toFixed(2)}</span>
                        <span className="font-mono text-sm font-bold text-amber-400">{a.deviation_sigma.toFixed(1)}&sigma;</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <AnalyticsCharts
            chartData={charts.chartData}
            compareEnabled={compareEnabled}
            areaData={charts.areaData}
            allToolNames={charts.allToolNames}
            pieData={charts.pieData}
            latencyData={charts.latencyData}
            barData={charts.barData}
            handleFailureBarClick={charts.handleFailureBarClick}
          />

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
        </div>
      </ContentBody>

      {healing.selectedIssue && (
        <HealingIssueModal
          issue={healing.selectedIssue}
          onResolve={(id) => healing.resolveHealingIssue(id)}
          onClose={() => healing.setSelectedIssue(null)}
        />
      )}
    </ContentBox>
  );
}
