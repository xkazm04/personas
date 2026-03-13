import { RefreshCw, BarChart3, AlertTriangle } from 'lucide-react';
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
        title="Analytics"
        subtitle="Unified cost, execution, and tool usage analytics"
        actions={
          <div className="flex items-center gap-2 flex-shrink-0">
            <AnalyticsSummaryCards
              totalCost={metrics.summary?.total_cost_usd || 0}
              totalExecutions={metrics.summary?.total_executions || 0}
              successRate={metrics.successRate}
              activePersonas={metrics.summary?.active_personas || 0}
            />
            <button
              onClick={() => { void metrics.refreshAllSafe(); }}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => metrics.setAutoRefresh(!metrics.autoRefresh)}
              className={`p-1.5 rounded-lg border transition-colors ${
                metrics.autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/90'
              }`}
              title={metrics.autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
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
        <div className="space-y-4">
          {/* Error banner */}
          {metrics.observabilityError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300">Metrics unavailable</p>
                  <p className="text-sm text-red-400/70 mt-0.5">{metrics.observabilityError}</p>
                </div>
                <button onClick={() => { void metrics.refreshAllSafe(); }} className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              </div>
            </div>
          )}

          {/* Cost anomaly alerts */}
          {metrics.costAnomalies.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    {metrics.costAnomalies.length} cost anomal{metrics.costAnomalies.length === 1 ? 'y' : 'ies'} detected
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {metrics.costAnomalies.map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm border bg-amber-500/15 text-amber-300 border-amber-500/25">
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
          onResolve={(id) => { healing.resolveHealingIssue(id); healing.setSelectedIssue(null); }}
          onClose={() => healing.setSelectedIssue(null)}
        />
      )}
    </ContentBox>
  );
}
