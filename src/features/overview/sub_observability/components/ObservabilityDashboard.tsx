import { DollarSign, Zap, CheckCircle, TrendingUp, Stethoscope, RefreshCw, AlertTriangle, Bell } from 'lucide-react';
import { useState } from 'react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
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
import { usePersonaStore } from '@/stores/personaStore';

export default function ObservabilityDashboard() {
  const d = useObservabilityData();
  const [showAlerts, setShowAlerts] = useState(false);
  const activeAlertCount = usePersonaStore((s) => s.alertHistory.filter(a => !a.dismissed).length);

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
              <p className="text-sm font-medium text-red-300">Metrics unavailable — data shown may be stale</p>
              <p className="text-sm text-red-400/70 mt-0.5">{d.observabilityError}</p>
            </div>
            <button onClick={d.refreshAll} className="flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-4 gap-4">
        <SummaryCard icon={DollarSign} label="Total Cost" numericValue={d.summary?.total_cost_usd || 0} format={(n) => `$${n.toFixed(2)}`} color="emerald" trend={d.trends.cost} sparklineData={d.chartData.slice(-7).map((p) => p.cost)} />
        <SummaryCard icon={Zap} label="Executions" numericValue={d.summary?.total_executions || 0} format={(n) => String(Math.round(n))} color="blue" trend={d.trends.executions} sparklineData={d.chartData.slice(-7).map((p) => p.executions)} />
        <SummaryCard icon={CheckCircle} label="Success Rate" numericValue={parseFloat(d.successRate)} format={(n) => `${n.toFixed(1)}%`} color="green" trend={d.trends.successRate} sparklineData={d.chartData.slice(-7).map((p) => { const total = p.success + p.failed; return total > 0 ? (p.success / total) * 100 : 0; })} />
        <SummaryCard icon={TrendingUp} label="Active Personas" numericValue={d.summary?.active_personas || 0} format={(n) => String(Math.round(n))} color="purple" trend={d.trends.personas} sparklineData={d.chartData.slice(-7).map((p) => p.active_personas)} />
      </div>

      {/* Alert Rules & History */}
      {showAlerts && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-primary/10 bg-secondary/10">
            <AlertRulesPanel />
          </div>
          <div className="p-4 rounded-xl border border-primary/10 bg-secondary/10">
            <AlertHistoryPanel />
          </div>
        </div>
      )}

      {/* Charts */}
      <MetricsCharts
        chartData={d.chartData}
        pieData={d.pieData}
        annotations={d.chartAnnotations}
        onFailureBarClick={(date) => {
          d.setFailureDrilldownDate(date);
          d.setOverviewTab('knowledge');
        }}
      />

      {/* IPC Performance */}
      <IpcPerformancePanel />

      {/* Health Issues Section */}
      <HealingIssuesPanel
        healingIssues={d.healingIssues}
        healingRunning={d.healingRunning}
        handleRunAnalysis={d.handleRunAnalysis}
        resolveHealingIssue={d.resolveHealingIssue}
        setSelectedIssue={d.setSelectedIssue}
        issueFilter={d.issueFilter}
        setIssueFilter={d.setIssueFilter}
        issueCounts={d.issueCounts}
        sortedFilteredIssues={d.sortedFilteredIssues}
        analysisResult={d.analysisResult}
        setAnalysisResult={() => d.setAnalysisResult(null)}
        analysisError={d.analysisError}
        setAnalysisError={() => d.setAnalysisError(null)}
      />
      </div>

      </ContentBody>

      {/* Healing Issue Detail Modal */}
      {d.selectedIssue && (
        <HealingIssueModal
          issue={d.selectedIssue}
          onResolve={(id) => { d.resolveHealingIssue(id); d.setSelectedIssue(null); }}
          onClose={() => d.setSelectedIssue(null)}
        />
      )}
    </ContentBox>
  );
}
