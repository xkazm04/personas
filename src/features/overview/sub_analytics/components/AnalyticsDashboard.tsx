import { RefreshCw, BarChart3, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import HealingIssueModal from '@/features/overview/sub_observability/components/HealingIssueModal';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewMetrics } from '../libs/useOverviewMetrics';
import { useChartSeries } from '../libs/useChartSeries';
import { useHealingWorkflow } from '../libs/useHealingWorkflow';
import { getAnomalyLabel, SEVERITY_STYLES } from '@/features/overview/libs/anomalySeverity';
import { useOverviewTranslation } from '@/features/overview/i18n/useOverviewTranslation';
import { dashboardContainer, dashboardItem } from '@/features/templates/animationPresets';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { AnalyticsSummaryCards } from './AnalyticsSummaryCards';
import { AnalyticsFilters } from './AnalyticsFilters';
import { AnalyticsCharts } from './AnalyticsCharts';
import { HealthIssuesPanel } from './HealthIssuesPanel';
import { RotationOverviewPanel } from './RotationOverviewPanel';

export default function AnalyticsDashboard() {
  const metrics = useOverviewMetrics();
  const charts = useChartSeries();
  const healing = useHealingWorkflow();
  const { t } = useOverviewTranslation();
  const { shouldAnimate } = useMotion();
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
              totalCost={metrics.summary?.totalCostUsd || 0}
              totalExecutions={metrics.summary?.totalExecutions || 0}
              successRate={metrics.successRate}
              activePersonas={metrics.summary?.activePersonas || 0}
              trends={metrics.trends}
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
        <AnimatePresence mode="wait">
        {!metrics.observabilityError && !metrics.summary ? (
          <motion.div
            key="empty"
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={shouldAnimate ? { opacity: 0 } : undefined}
            transition={{ duration: 0.2 }}
          >
            <EmptyState variant="chart" heading={t.emptyState.analytics_title} description={t.emptyState.analytics_subtitle} />
          </motion.div>
        ) : (
        <motion.div
          key={`analytics-${days}-${selectedPersonaId}`}
          className="space-y-5"
          variants={shouldAnimate ? dashboardContainer : undefined}
          initial={shouldAnimate ? "hidden" : false}
          animate="show"
          exit={shouldAnimate ? { opacity: 0, transition: { duration: 0.15 } } : undefined}
        >
          {/* Error banner */}
          {metrics.observabilityError && (
            <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
              <InlineErrorBanner
                severity="error"
                title="Metrics unavailable"
                message={metrics.observabilityError}
                onRetry={() => { void metrics.refreshAllSafe(); }}
              />
            </motion.div>
          )}

          {/* Cost anomaly alerts */}
          {metrics.costAnomalies.length > 0 && (
            <motion.div variants={shouldAnimate ? dashboardItem : undefined} className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    {t.anomaly.cost_anomalies_detected
                      .replace('{count}', String(metrics.costAnomalies.length))
                      .replace('{plural}', metrics.costAnomalies.length === 1 ? 'y' : 'ies')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {metrics.costAnomalies.map((a, i) => {
                      const label = getAnomalyLabel(a.deviation_sigma);
                      const sev = SEVERITY_STYLES[label.severity];
                      const severityText = t.anomaly[`severity_${label.severity}` as const];
                      return (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm border ${sev.bg} ${sev.text} ${sev.border}`}
                          title={t.anomaly.sigma_tooltip.replace('{value}', a.deviation_sigma.toFixed(1))}
                        >
                          {new Date(a.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          <span className="font-mono text-sm opacity-80">${a.cost.toFixed(2)}</span>
                          <span className={`text-sm font-bold ${sev.text}`}>
                            {severityText} &middot; {label.multiplier} {t.anomaly.above_normal}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
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
          </motion.div>

          <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
            <RotationOverviewPanel />
          </motion.div>

          <motion.div variants={shouldAnimate ? dashboardItem : undefined}>
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
          </motion.div>
        </motion.div>
        )}
        </AnimatePresence>
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
