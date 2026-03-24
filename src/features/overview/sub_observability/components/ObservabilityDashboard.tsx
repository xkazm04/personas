import { DollarSign, Zap, CheckCircle, TrendingUp, Stethoscope, RefreshCw, AlertTriangle, Bell, Activity } from 'lucide-react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DayRangePicker } from '@/features/overview/sub_usage/components/DayRangePicker';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { MetricsCharts } from './MetricsCharts';
import { SummaryCard } from './SpendOverview';
import IpcPerformancePanel from './IpcPerformancePanel';
import HealingIssueModal from './HealingIssueModal';
import { HealingIssuesPanel } from './HealingIssuesPanel';
import { AlertRulesPanel } from './AlertRulesPanel';
import { AlertHistoryPanel } from './AlertHistoryPanel';
import { useObservabilityData } from '../libs/useObservabilityData';
import { useOverviewStore } from '@/stores/overviewStore';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import SystemTraceViewer from './SystemTraceViewer';

export default function ObservabilityDashboard() {
  const d = useObservabilityData();
  const [showAlerts, setShowAlerts] = useState(false);
  const activeAlertCount = useOverviewStore((s) => {
    let count = 0;
    for (const a of s.alertHistory) { if (!a.dismissed) count++; }
    return count;
  });

  // --- Healing UI state (split from data hook to avoid chart rerenders) ---
  const [selectedIssue, setSelectedIssue] = useState<PersonaHealingIssue | null>(null);
  const [issueFilter, setIssueFilter] = useState<'all' | 'open' | 'auto-fixed'>('all');
  const [analysisResult, setAnalysisResult] = useState<{
    failures_analyzed: number;
    issues_created: number;
    auto_fixed: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [healingViewMode, setHealingViewMode] = useState<'list' | 'timeline'>('list');

  const handleRunAnalysis = useCallback(async () => {
    setAnalysisResult(null);
    setAnalysisError(null);
    try {
      const result = await d.triggerHealing(d.selectedPersonaId || d.personas[0]?.id);
      if (result) {
        setAnalysisResult(result);
      } else {
        setAnalysisError('Healing analysis failed. Please try again.');
      }
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Healing analysis failed');
    }
  }, [d.triggerHealing, d.selectedPersonaId, d.personas]);

  // Fetch timeline when switching to timeline view or when persona changes
  useEffect(() => {
    if (healingViewMode === 'timeline') {
      const pid = d.selectedPersonaId || d.personas[0]?.id;
      if (pid) d.fetchHealingTimeline(pid);
    }
  }, [healingViewMode, d.selectedPersonaId, d.personas, d.fetchHealingTimeline]);

  const { issueCounts, sortedFilteredIssues } = useMemo(() => {
    let open = 0, autoFixed = 0;
    for (const i of d.healingIssues) {
      if (i.auto_fixed) autoFixed++;
      else open++;
    }
    const counts = { all: d.healingIssues.length, open, autoFixed };
    const filtered = issueFilter === 'all' ? d.healingIssues
      : issueFilter === 'open' ? d.healingIssues.filter(i => !i.auto_fixed)
      : d.healingIssues.filter(i => i.auto_fixed);
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...filtered].sort((a, b) => {
      if (a.auto_fixed !== b.auto_fixed) return a.auto_fixed ? 1 : -1;
      return (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    });
    return { issueCounts: counts, sortedFilteredIssues: sorted };
  }, [d.healingIssues, issueFilter]);

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

  return (
    <ContentBox>
      <ContentHeader
        icon={<Stethoscope className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Observability"
        subtitle="Performance metrics, cost tracking, execution health"
        actions={
          <>
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className={`relative p-1.5 rounded-lg border transition-colors ${
                showAlerts ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-primary/15 text-muted-foreground/90 hover:bg-secondary/50'
              }`}
              title="Alert rules &amp; history"
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
              title="Refresh metrics"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => d.setAutoRefresh(!d.autoRefresh)}
              className={`p-1.5 rounded-lg border transition-colors ${
                d.autoRefresh ? 'border-primary/30 bg-primary/10 text-primary' : 'border-primary/15 text-muted-foreground/90'
              }`}
              title={d.autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${d.autoRefresh ? 'animate-spin' : ''}`} style={d.autoRefresh ? { animationDuration: '3s' } : {}} />
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
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="typo-heading text-red-300">Metrics unavailable -- data shown may be stale</p>
              <p className="text-sm text-red-400/70 mt-0.5">{d.observabilityError}</p>
            </div>
            <button onClick={d.refreshAll} className="flex items-center gap-1.5 px-2.5 py-1 typo-heading rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-4 gap-4">
        <SummaryCard icon={DollarSign} label="Total Cost" numericValue={d.summary?.total_cost_usd || 0} format={(n) => `$${n.toFixed(2)}`} color="emerald" trend={d.trends.cost} sparklineData={sparklineCost} />
        <SummaryCard icon={Zap} label="Executions" numericValue={d.summary?.total_executions || 0} format={(n) => String(Math.round(n))} color="blue" trend={d.trends.executions} sparklineData={sparklineExec} />
        <SummaryCard icon={CheckCircle} label="Success Rate" numericValue={parseFloat(d.successRate)} format={(n) => `${n.toFixed(1)}%`} color="green" trend={d.trends.successRate} sparklineData={sparklineSuccess} />
        <SummaryCard icon={TrendingUp} label="Active Personas" numericValue={d.summary?.active_personas || 0} format={(n) => String(Math.round(n))} color="purple" trend={d.trends.personas} sparklineData={sparklinePersonas} />
      </div>

      {/* Alert Rules & History */}
      {showAlerts && (
          <div className="animate-fade-slide-in"
            key="alerts-panel"
            style={{ overflow: "hidden" }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-primary/10 bg-secondary/10">
                <AlertRulesPanel />
              </div>
              <div className="p-4 rounded-xl border border-primary/10 bg-secondary/10">
                <AlertHistoryPanel />
              </div>
            </div>
          </div>
        )}

      {/* Charts */}
      <MetricsCharts
        chartData={d.chartData}
        pieData={d.pieData}
        annotations={d.chartAnnotations}
        onFailureBarClick={handleFailureBarClick}
      />

      {/* IPC Performance */}
      <IpcPerformancePanel />

      {/* System Trace Timeline */}
      <div className="p-4 rounded-xl border border-primary/10 bg-secondary/10 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="typo-heading text-foreground/90">System Trace Timeline</h3>
        </div>
        <SystemTraceViewer />
      </div>

      {/* Health Issues Section */}
      <HealingIssuesPanel
        healingIssues={d.healingIssues}
        healingRunning={d.healingRunning}
        handleRunAnalysis={handleRunAnalysis}
        resolveHealingIssue={d.resolveHealingIssue}
        setSelectedIssue={setSelectedIssue}
        issueFilter={issueFilter}
        setIssueFilter={setIssueFilter}
        issueCounts={issueCounts}
        sortedFilteredIssues={sortedFilteredIssues}
        analysisResult={analysisResult}
        setAnalysisResult={() => setAnalysisResult(null)}
        analysisError={analysisError}
        setAnalysisError={() => setAnalysisError(null)}
        viewMode={healingViewMode}
        setViewMode={setHealingViewMode}
        timelineEvents={d.healingTimeline}
        timelineLoading={d.healingTimelineLoading}
      />
      </div>

      </ContentBody>

      {/* Healing Issue Detail Modal */}
      {selectedIssue && (
        <HealingIssueModal
          issue={selectedIssue}
          onResolve={(id) => { d.resolveHealingIssue(id); setSelectedIssue(null); }}
          onClose={() => setSelectedIssue(null)}
        />
      )}
    </ContentBox>
  );
}
