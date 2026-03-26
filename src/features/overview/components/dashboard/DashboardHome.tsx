import { LayoutDashboard, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useMemo } from 'react';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import DeployFirstAutomationCard from '@/features/overview/components/dashboard/cards/DeployFirstAutomationCard';
import { HealthDigestPanel } from '@/features/agents/health';
import { MemoryActionsPanel } from '@/features/overview/sub_memories/components/MemoryActionCard';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import RemoteControlCard from '@/features/overview/components/dashboard/cards/RemoteControlCard';
import FleetOptimizationCard from '@/features/overview/components/dashboard/cards/FleetOptimizationCard';
import ResumeSetupCard from '@/features/overview/components/dashboard/cards/ResumeSetupCard';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { DASHBOARD_GRID } from '@/features/overview/utils/dashboardGrid';
import { DashboardHeaderBadges } from './widgets/DashboardHeaderBadges';
import { RecentActivityList } from './widgets/RecentActivityList';
import { TrafficErrorsChart } from './widgets/TrafficErrorsChart';

export default function DashboardHome() {
  const user = useAuthStore((s) => s.user);
  const personas = useAgentStore((s) => s.personas);
  const {
    globalExecutions, globalExecutionsTotal, pendingReviewCount,
    unreadMessageCount, memoryActions, executionDashboard, alertHistory, pipelineError,
  } = useOverviewStore(useShallow((s) => ({
    globalExecutions: s.globalExecutions,
    globalExecutionsTotal: s.globalExecutionsTotal,
    pendingReviewCount: s.pendingReviewCount,
    unreadMessageCount: s.unreadMessageCount,
    memoryActions: s.memoryActions,
    executionDashboard: s.executionDashboard,
    alertHistory: s.alertHistory,
    pipelineError: s.pipelineError,
  })));
  const {
    setOverviewTab, dismissMemoryAction, setPipelineError,
  } = useOverviewStore(useShallow((s) => ({
    setOverviewTab: s.setOverviewTab,
    dismissMemoryAction: s.dismissMemoryAction,
    setPipelineError: s.setPipelineError,
  })));
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId } = useOverviewFilterActions();

  const dailyPoints = executionDashboard?.daily_points ?? [];

  // Note: fetchPendingReviewCount and fetchUnreadMessageCount are handled by
  // Sidebar's centralized polling (always mounted when Dashboard is visible).
  // All data fetches (globalExecutions, healingIssues, etc.) are centralized
  // in useExecutionDashboardPipeline at the OverviewContent level to avoid
  // redundant re-fetches on subtab switches.

  const activeAlertCount = useMemo(() => {
    let count = 0;
    for (const a of alertHistory) { if (!a.dismissed) count++; }
    return count;
  }, [alertHistory]);

  const stats = useMemo(() => {
    const execs = globalExecutions;
    const successCount = execs.filter(e => e.status === 'completed').length;
    const successRate = Math.round(resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: successCount, denominator: execs.length },
    ));
    return { successRate, activeAgents: personas.length, recentExecs: execs.slice(0, 12) };
  }, [globalExecutions, personas]);

  const chartData = useMemo(() => {
    if (!dailyPoints.length) return [];
    return dailyPoints.map(p => ({ date: p.date, traffic: p.total_executions, errors: p.failed }));
  }, [dailyPoints]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const displayName = user?.display_name || user?.email?.split('@')[0] || 'Operator';

  const chartTotals = useMemo(() => {
    const totalTraffic = chartData.reduce((s, d) => s + d.traffic, 0);
    const totalErrors = chartData.reduce((s, d) => s + d.errors, 0);
    return { totalTraffic, totalErrors };
  }, [chartData]);

  return (
    <ContentBox>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[5%] right-[-5%] w-[30%] h-[30%] bg-violet-500/5 blur-[100px] rounded-full" />
      </div>

      <ContentHeader
        icon={<LayoutDashboard className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title="Dashboard"
        subtitle="Operational overview and system status"
        actions={
          <DashboardHeaderBadges
            unreadMessageCount={unreadMessageCount}
            pendingReviewCount={pendingReviewCount}
            globalExecutionsTotal={globalExecutionsTotal}
            successRate={stats.successRate}
            activeAgents={stats.activeAgents}
            activeAlertCount={activeAlertCount}
            setOverviewTab={setOverviewTab}
          />
        }
      />

      <ContentBody centered>
        <div className="space-y-5 pb-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-2">
            <div>
              <h2
                className={`animate-fade-slide-in ${IS_MOBILE ? 'typo-heading-lg' : 'text-3xl font-bold'} bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent`}
              >
                {greeting}, {displayName}
              </h2>
              <p className="text-muted-foreground/80 mt-1">
                You have <span className="text-primary font-medium"><AnimatedCounter value={pendingReviewCount} /> pending reviews</span> requiring attention.
              </p>
            </div>
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
          </div>

          {pipelineError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="typo-heading text-red-300">Dashboard data may be stale</p>
                  <p className="text-sm text-red-400/70 mt-0.5">{pipelineError}</p>
                </div>
                <button onClick={() => setPipelineError(null)} className="flex items-center gap-1.5 px-2.5 py-1 typo-heading rounded-xl bg-red-500/15 border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Dismiss
                </button>
              </div>
            </div>
          )}
          {IS_MOBILE && <RemoteControlCard />}
          <ResumeSetupCard />
          <MemoryActionsPanel actions={memoryActions} onDismiss={dismissMemoryAction} />
          <FleetOptimizationCard />

          <div className={DASHBOARD_GRID}>
            <RecentActivityList recentExecs={stats.recentExecs} onViewAll={() => setOverviewTab('executions')} />

            <div className="space-y-5">
              <TrafficErrorsChart chartData={chartData} totalTraffic={chartTotals.totalTraffic} totalErrors={chartTotals.totalErrors} />
              {import.meta.env.DEV && (
                <div className="rounded-xl border-2 border-amber-500/40 p-0.5">
                  <HealthDigestPanel />
                </div>
              )}
              <DeployFirstAutomationCard />
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
