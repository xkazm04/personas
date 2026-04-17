import { LayoutDashboard } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { StalenessIndicator } from '@/features/shared/components/feedback/StalenessIndicator';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Suspense, useCallback, useMemo } from 'react';
import { selectActiveAlertCount } from '@/stores/selectors/activeAlertCount';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { HealthDigestPanel } from '@/features/agents/health';
import { MemoryActionsPanel } from '@/features/overview/sub_memories/components/MemoryActionCard';
import { DashboardEmptyState } from './DashboardEmptyState';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import RemoteControlCard from '@/features/overview/components/dashboard/cards/RemoteControlCard';
import FleetOptimizationCard from '@/features/overview/components/dashboard/cards/FleetOptimizationCard';
import { TopPerformersWidget } from './widgets/TopPerformersWidget';
import ResumeSetupCard from '@/features/overview/components/dashboard/cards/ResumeSetupCard';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import { DashboardHeaderBadges } from './widgets/DashboardHeaderBadges';
import { RecentActivityList } from './widgets/RecentActivityList';
import { TrafficErrorsChart } from './widgets/TrafficErrorsChart';
import { lazyRetry } from '@/lib/lazyRetry';

const AnalyticsInserts = lazyRetry(() => import('./widgets/AnalyticsInserts'));

export default function DashboardHome() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const personas = useAgentStore((s) => s.personas);
  const {
    globalExecutions, globalExecutionsTotal, pendingReviewCount,
    unreadMessageCount, memoryActions, executionDashboard, pipelineErrors,
    pipelineFetchedAt, setOverviewTab, dismissMemoryAction, setPipelineError,
    activeAlertCount,
  } = useOverviewStore(useShallow((s) => ({
    globalExecutions: s.globalExecutions,
    globalExecutionsTotal: s.globalExecutionsTotal,
    pendingReviewCount: s.pendingReviewCount,
    unreadMessageCount: s.unreadMessageCount,
    memoryActions: s.memoryActions,
    executionDashboard: s.executionDashboard,
    pipelineErrors: s.pipelineErrors,
    pipelineFetchedAt: s.pipelineFetchedAt,
    setOverviewTab: s.setOverviewTab,
    dismissMemoryAction: s.dismissMemoryAction,
    setPipelineError: s.setPipelineError,
    activeAlertCount: selectActiveAlertCount(s),
  })));
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId } = useOverviewFilterActions();

  const dailyPoints = executionDashboard?.daily_points ?? [];

  // Note: fetchPendingReviewCount and fetchUnreadMessageCount are handled by
  // Sidebar's centralized polling (always mounted when Dashboard is visible).
  // All data fetches (globalExecutions, healingIssues, etc.) are centralized
  // in useExecutionDashboardPipeline at the OverviewContent level to avoid
  // redundant re-fetches on subtab switches.

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
    if (hour < 12) return t.overview.dashboard.greeting_morning;
    if (hour < 18) return t.overview.dashboard.greeting_afternoon;
    return t.overview.dashboard.greeting_evening;
  }, [t]);

  const displayName = user?.display_name || user?.email?.split('@')[0] || t.overview.dashboard.default_user;

  const chartTotals = useMemo(() => {
    const totalTraffic = chartData.reduce((s, d) => s + d.traffic, 0);
    const totalErrors = chartData.reduce((s, d) => s + d.errors, 0);
    return { totalTraffic, totalErrors };
  }, [chartData]);

  const handleViewAllExecs = useCallback(() => setOverviewTab('executions'), [setOverviewTab]);

  const isEmptyDashboard = personas.length === 0 && globalExecutions.length === 0;

  return (
    <ContentBox>
      <HeroMesh preset="dashboard" />

      <ContentHeader
        icon={<LayoutDashboard className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title={t.overview.dashboard.title}
        subtitle={t.overview.dashboard.subtitle}
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
                className={`animate-fade-slide-in motion-reduce:opacity-100 typo-heading-lg bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent`}
              >
                {greeting}, {displayName}
              </h2>
              <p className="text-foreground mt-1">
                {isEmptyDashboard
                  ? t.overview.dashboard.empty_cta
                  : <>You have <span className="text-primary font-medium"><AnimatedCounter value={pendingReviewCount} /> {t.overview.dashboard.pending_reviews_prompt}</span> {t.overview.dashboard.requiring_attention}</>
                }
              </p>
            </div>
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
          </div>

          {Object.keys(pipelineErrors).length > 0 && (
            <div className="space-y-2">
              {Object.entries(pipelineErrors).map(([source, msg]) => (
                <InlineErrorBanner
                  key={source}
                  severity="warning"
                  compact
                  title={`${source} ${t.overview.dashboard.pipeline_failed.replace('{source}', '').trim()}`}
                  message={msg}
                  onDismiss={() => setPipelineError(source, null)}
                  actions={
                    <StalenessIndicator
                      fetchedAt={pipelineFetchedAt[source]}
                      hasError
                      label={source}
                    />
                  }
                />
              ))}
            </div>
          )}
          {IS_MOBILE && <RemoteControlCard />}
          <ResumeSetupCard />
          <MemoryActionsPanel actions={memoryActions} onDismiss={dismissMemoryAction} />
          <FleetOptimizationCard />
          <TopPerformersWidget />

          {isEmptyDashboard ? (
            <DashboardEmptyState />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Left: Recent Activity */}
              <div className="relative">
                <StalenessIndicator fetchedAt={pipelineFetchedAt.globalExecutions} hasError={!!pipelineErrors.globalExecutions} label="Recent activity" />
                <RecentActivityList recentExecs={stats.recentExecs} onViewAll={handleViewAllExecs} />
              </div>

              {/* Center: Traffic/Errors + Execution Health + Cost Over Time */}
              <div className="space-y-4">
                <div className="relative">
                  <StalenessIndicator fetchedAt={pipelineFetchedAt.executionDashboard} hasError={!!pipelineErrors.executionDashboard} label="Traffic & errors" />
                  <TrafficErrorsChart chartData={chartData} totalTraffic={chartTotals.totalTraffic} totalErrors={chartTotals.totalErrors} />
                </div>
                <Suspense fallback={null}>
                  <AnalyticsInserts position="center" />
                </Suspense>
              </div>

              {/* Right: Health Digest + Deploy + Rotation + Health Issues */}
              <div className="space-y-4">
                <HealthDigestPanel />
                <Suspense fallback={null}>
                  <AnalyticsInserts position="right" />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
