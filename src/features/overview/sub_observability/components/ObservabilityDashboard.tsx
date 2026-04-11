import { DollarSign, Zap, CheckCircle, TrendingUp, Stethoscope, RefreshCw, Bell, Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { StalenessIndicator } from '@/features/shared/components/feedback/StalenessIndicator';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DayRangePicker } from '@/features/overview/sub_usage/components/DayRangePicker';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { MetricsCharts } from './MetricsCharts';
import { OverviewStatCard as SummaryCard } from './OverviewStatCard';
import IpcPerformancePanel from './IpcPerformancePanel';
import HealingIssueModal from './HealingIssueModal';
import { HealingIssuesPanel } from './HealingIssuesPanel';
import { AiHealingStreamOverlay } from './AiHealingStreamOverlay';
import { AlertRulesPanel } from './AlertRulesPanel';
import { AlertHistoryPanel } from './AlertHistoryPanel';
import { useObservabilityData } from '../libs/useObservabilityData';
import { useHealingPanelState } from '../libs/useHealingPanelState';
import { useAnomalyDrilldown } from '../libs/useAnomalyDrilldown';
import { useOverviewStore } from '@/stores/overviewStore';
import { selectActiveAlertCount } from '@/stores/selectors/activeAlertCount';
import AnomalyDrilldownPanel from './AnomalyDrilldownPanel';
import SystemTraceViewer from './SystemTraceViewer';

export default function ObservabilityDashboard() {
  const { t } = useTranslation();
  const d = useObservabilityData();
  const [showAlerts, setShowAlerts] = useState(false);
  const activeAlertCount = useOverviewStore(selectActiveAlertCount);
  const { pipelineErrors, pipelineFetchedAt } = useOverviewStore((s) => ({
    pipelineErrors: s.pipelineErrors,
    pipelineFetchedAt: s.pipelineFetchedAt,
  }));

  const drilldown = useAnomalyDrilldown();

  // AI healing live stream
  const aiHealing = useAiHealingStream(d.selectedPersonaId ?? '');
  const [healingDismissed, setHealingDismissed] = useState(false);
  // Reset dismissed state when a new healing session starts
  const showHealingOverlay = aiHealing.phase !== 'idle' && !healingDismissed;
  useEffect(() => {
    if (aiHealing.phase === 'started') setHealingDismissed(false);
  }, [aiHealing.phase]);

  const healing = useHealingPanelState({
    healingIssues: d.healingIssues,
    triggerHealing: d.triggerHealing,
    selectedPersonaId: d.selectedPersonaId,
    personas: d.personas,
    fetchHealingTimeline: d.fetchHealingTimeline,
  });

  // --- Memoized sparkline data (stable references prevent SummaryCard rerenders) ---
  const sparklineCost = useMemo(() => d.chartData.slice(-7).map((p) => p.cost), [d.chartData]);
  const sparklineExec = useMemo(() => d.chartData.slice(-7).map((p) => p.executions), [d.chartData]);
  const sparklineSuccess = useMemo(() => d.chartData.slice(-7).map((p) => {
    const total = p.success + p.failed;
    return total > 0 ? (p.success / total) * 100 : 0;
  }), [d.chartData]);
  const sparklinePersonas = useMemo(() => d.chartData.slice(-7).map((p) => p.active_personas), [d.chartData]);

  // Stable callback so MetricsCharts memo isn't defeated by inline arrow
  const handleFailureBarClick = useCallback((date: string) => {
    d.setFailureDrilldownDate(date);
    d.setOverviewTab('knowledge');
  }, [d.setFailureDrilldownDate, d.setOverviewTab]);

  const handleAnomalyClick = useCallback((anomaly: import('@/lib/bindings/MetricAnomaly').MetricAnomaly) => {
    drilldown.openDrilldown(anomaly, d.selectedPersonaId);
  }, [drilldown.openDrilldown, d.selectedPersonaId]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Stethoscope className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.overview.observability.title}
        subtitle={t.overview.observability.subtitle}
        actions={
          <>
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className={`relative p-1.5 rounded-lg border transition-colors ${
                showAlerts ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-primary/15 text-muted-foreground/90 hover:bg-secondary/50'
              }`}
              title={t.overview.observability.alert_rules}
            >
              <Bell className="w-3.5 h-3.5" />
              {activeAlertCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {activeAlertCount > 9 ? '9+' : activeAlertCount}
                </span>
              )}
            </button>
            <button
              onClick={d.refreshAll}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title={t.overview.observability.refresh_metrics}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => d.setAutoRefresh(!d.autoRefresh)}
              className={`p-1.5 rounded-lg border transition-colors ${
                d.autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/90'
              }`}
              title={d.autoRefresh ? t.overview.observability_extra.auto_refresh_on : t.overview.observability_extra.auto_refresh_off}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${d.autoRefresh ? 'animate-spin motion-reduce:animate-none' : ''}`} style={d.autoRefresh ? { animationDuration: '3s' } : {}} />
            </button>
          </>
        }
      />

      {/* Filter bar */}
      <div className="px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 flex items-center gap-4 flex-wrap flex-shrink-0">
        <PersonaSelect value={d.selectedPersonaId} onChange={d.setSelectedPersonaId} personas={d.personas} />
        <DayRangePicker value={d.days} onChange={d.setDays} customDateRange={d.customDateRange} onCustomDateRangeChange={d.setCustomDateRange} />
      </div>

      <ContentBody>
      <div className="space-y-4">

      {/* Metrics Fetch Error Banner */}
      {d.observabilityError && (
        <InlineErrorBanner
          severity="error"
          title={t.overview.observability.metrics_unavailable}
          message={d.observabilityError}
          onRetry={d.refreshAll}
          actions={
            <StalenessIndicator
              fetchedAt={pipelineFetchedAt.observabilityMetrics}
              hasError
              label="Observability metrics"
            />
          }
        />
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-4 gap-4">
        <SummaryCard icon={DollarSign} label={t.overview.observability_extra.total_cost} numericValue={d.summary?.totalCostUsd || 0} format={(n) => `$${n.toFixed(2)}`} color="emerald" trend={d.trends.cost} sparklineData={sparklineCost} />
        <SummaryCard icon={Zap} label={t.overview.observability_extra.executions_label} numericValue={d.summary?.totalExecutions || 0} format={(n) => String(Math.round(n))} color="blue" trend={d.trends.executions} sparklineData={sparklineExec} />
        <SummaryCard icon={CheckCircle} label={t.overview.observability_extra.success_rate} numericValue={parseFloat(d.successRate)} format={(n) => `${n.toFixed(1)}%`} color="green" trend={d.trends.successRate} sparklineData={sparklineSuccess} />
        <SummaryCard icon={TrendingUp} label={t.overview.observability_extra.active_personas} numericValue={d.summary?.activePersonas || 0} format={(n) => String(Math.round(n))} color="purple" trend={d.trends.personas} sparklineData={sparklinePersonas} />
      </div>

      {/* Alert Rules & History */}
      {showAlerts && (
          <div className="animate-fade-slide-in motion-reduce:opacity-100"
            key="alerts-panel"
            style={{ overflow: "hidden" }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-primary/10 bg-secondary/20">
                <div className="flex items-center justify-end mb-2">
                  <StalenessIndicator fetchedAt={pipelineFetchedAt.alertRules} hasError={!!pipelineErrors.alertRules} label="Alert rules" />
                </div>
                <AlertRulesPanel />
              </div>
              <div className="p-4 rounded-xl border border-primary/10 bg-secondary/20">
                <div className="flex items-center justify-end mb-2">
                  <StalenessIndicator fetchedAt={pipelineFetchedAt.alertHistory} hasError={!!pipelineErrors.alertHistory} label="Alert history" />
                </div>
                <AlertHistoryPanel />
              </div>
            </div>
          </div>
        )}

      {/* Charts */}
      <MetricsCharts
        chartData={d.chartData}
        pieData={d.pieData}
        anomalies={d.chartAnomalies}
        annotations={d.chartAnnotations}
        onFailureBarClick={handleFailureBarClick}
        onAnomalyClick={handleAnomalyClick}
      />

      {/* IPC Performance */}
      <IpcPerformancePanel />

      {/* System Trace Timeline */}
      <div className="p-4 rounded-xl border border-primary/10 bg-secondary/20 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="typo-heading text-foreground/90">{t.overview.observability_extra.system_trace}</h3>
        </div>
        <SystemTraceViewer />
      </div>

      {/* AI Healing Live Stream */}
      {showHealingOverlay && (
        <AiHealingStreamOverlay
          healing={aiHealing}
          onDismiss={() => setHealingDismissed(true)}
        />
      )}

      {/* Health Issues Section */}
      <HealingIssuesPanel
        healingIssues={d.healingIssues}
        healingRunning={d.healingRunning}
        handleRunAnalysis={healing.handleRunAnalysis}
        resolveHealingIssue={d.resolveHealingIssue}
        setSelectedIssue={healing.setSelectedIssue}
        issueFilter={healing.issueFilter}
        setIssueFilter={healing.setIssueFilter}
        issueCounts={healing.issueCounts}
        sortedFilteredIssues={healing.sortedFilteredIssues}
        analysisResult={healing.analysisResult}
        setAnalysisResult={() => healing.setAnalysisResult(null)}
        analysisError={healing.analysisError}
        setAnalysisError={() => healing.setAnalysisError(null)}
        viewMode={healing.healingViewMode}
        setViewMode={healing.setHealingViewMode}
        timelineEvents={d.healingTimeline}
        timelineLoading={d.healingTimelineLoading}
        selectedPersonaId={d.selectedPersonaId}
      />
      </div>

      </ContentBody>

      {/* Healing Issue Detail Modal */}
      {healing.selectedIssue && (
        <HealingIssueModal
          issue={healing.selectedIssue}
          onResolve={(id) => d.resolveHealingIssue(id)}
          onClose={() => healing.setSelectedIssue(null)}
        />
      )}

      {/* Anomaly Drill-Down Modal */}
      {drilldown.selectedAnomaly && (
        <AnomalyDrilldownPanel
          anomaly={drilldown.selectedAnomaly}
          data={drilldown.drilldownData}
          loading={drilldown.loading}
          error={drilldown.error}
          onClose={drilldown.closeDrilldown}
        />
      )}
    </ContentBox>
  );
}
