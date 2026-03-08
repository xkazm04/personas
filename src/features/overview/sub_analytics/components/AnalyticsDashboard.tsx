import { RefreshCw, BarChart3, AlertTriangle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import HealingIssueModal from '@/features/overview/sub_observability/components/HealingIssueModal';
import { useAnalyticsData } from '../libs/useAnalyticsData';
import { AnalyticsSummaryCards } from './AnalyticsSummaryCards';
import { AnalyticsFilters } from './AnalyticsFilters';
import { AnalyticsCharts } from './AnalyticsCharts';
import { HealthIssuesPanel } from './HealthIssuesPanel';

export default function AnalyticsDashboard() {
  const data = useAnalyticsData();

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
              totalCost={data.summary?.total_cost_usd || 0}
              totalExecutions={data.summary?.total_executions || 0}
              successRate={data.successRate}
              activePersonas={data.summary?.active_personas || 0}
            />
            <button
              onClick={() => { void data.refreshAllSafe(); }}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => data.setAutoRefresh(!data.autoRefresh)}
              className={`p-1.5 rounded-lg border transition-colors ${
                data.autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/90'
              }`}
              title={data.autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${data.autoRefresh ? 'animate-spin' : ''}`} style={data.autoRefresh ? { animationDuration: '3s' } : {}} />
            </button>
          </div>
        }
      />

      <AnalyticsFilters
        selectedPersonaId={data.selectedPersonaId}
        setSelectedPersonaId={data.setSelectedPersonaId}
        days={data.days}
        setDays={data.setDays}
        customDateRange={data.customDateRange}
        setCustomDateRange={data.setCustomDateRange}
        compareEnabled={data.compareEnabled}
        setCompareEnabled={data.setCompareEnabled}
        personas={data.personas}
      />

      <ContentBody>
        <div className="space-y-4">
          {/* Error banner */}
          {data.observabilityError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-red-300">Metrics unavailable</p>
                  <p className="text-sm text-red-400/70 mt-0.5">{data.observabilityError}</p>
                </div>
                <button onClick={() => { void data.refreshAllSafe(); }} className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
              </div>
            </div>
          )}

          {/* Cost anomaly alerts */}
          {data.costAnomalies.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    {data.costAnomalies.length} cost anomal{data.costAnomalies.length === 1 ? 'y' : 'ies'} detected
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {data.costAnomalies.map((a, i) => (
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
            chartData={data.chartData}
            compareEnabled={data.compareEnabled}
            areaData={data.areaData}
            allToolNames={data.allToolNames}
            pieData={data.pieData}
            latencyData={data.latencyData}
            barData={data.barData}
            handleFailureBarClick={data.handleFailureBarClick}
          />

          <HealthIssuesPanel
            healingIssues={data.healingIssues}
            healingRunning={data.healingRunning}
            sortedFilteredIssues={data.sortedFilteredIssues}
            issueFilter={data.issueFilter}
            setIssueFilter={data.setIssueFilter}
            issueCounts={data.issueCounts}
            analysisResult={data.analysisResult}
            analysisError={data.analysisError}
            setAnalysisResult={data.setAnalysisResult}
            setAnalysisError={data.setAnalysisError}
            handleRunAnalysis={data.handleRunAnalysis}
            resolveHealingIssue={data.resolveHealingIssue}
            onSelectIssue={data.setSelectedIssue}
          />
        </div>
      </ContentBody>

      {data.selectedIssue && (
        <HealingIssueModal
          issue={data.selectedIssue}
          onResolve={(id) => { data.resolveHealingIssue(id); data.setSelectedIssue(null); }}
          onClose={() => data.setSelectedIssue(null)}
        />
      )}
    </ContentBox>
  );
}
