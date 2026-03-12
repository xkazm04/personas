import { motion } from 'framer-motion';
import { LayoutDashboard } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useMemo, useEffect } from 'react';
import { useFilteredCollection } from '@/hooks/utility/data/useFilteredCollection';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilters } from '@/features/overview/components/dashboard/OverviewFilterContext';
import DeployFirstAutomationCard from '@/features/overview/components/dashboard/cards/DeployFirstAutomationCard';
import { HealthDigestPanel } from '@/features/agents/health';
import { MemoryActionsPanel } from '@/features/overview/sub_memories/components/MemoryActionCard';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import RemoteControlCard from '@/features/overview/components/dashboard/cards/RemoteControlCard';
import FleetOptimizationCard from '@/features/overview/components/dashboard/cards/FleetOptimizationCard';
import { DashboardHeaderBadges } from './widgets/DashboardHeaderBadges';
import { RecentActivityList } from './widgets/RecentActivityList';
import { TrafficErrorsChart } from './widgets/TrafficErrorsChart';

export default function DashboardHome() {
  const user = useAuthStore((s) => s.user);
  const personas = usePersonaStore((s) => s.personas);
  const globalExecutions = usePersonaStore((s) => s.globalExecutions);
  const globalExecutionsTotal = usePersonaStore((s) => s.globalExecutionsTotal);
  const pendingReviewCount = usePersonaStore((s) => s.pendingReviewCount);
  const unreadMessageCount = usePersonaStore((s) => s.unreadMessageCount);
  const fetchGlobalExecutions = usePersonaStore((s) => s.fetchGlobalExecutions);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const fetchUnreadMessageCount = usePersonaStore((s) => s.fetchUnreadMessageCount);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);
  const memoryActions = usePersonaStore((s) => s.memoryActions);
  const dismissMemoryAction = usePersonaStore((s) => s.dismissMemoryAction);
  const { selectedPersonaId, setSelectedPersonaId } = useOverviewFilters();
  const executionDashboard = usePersonaStore((s) => s.executionDashboard);
  const fetchHealingIssues = usePersonaStore((s) => s.fetchHealingIssues);

  const dailyPoints = executionDashboard?.daily_points ?? [];

  useEffect(() => {
    fetchGlobalExecutions(true);
    fetchPendingReviewCount();
    fetchUnreadMessageCount();
    fetchHealingIssues();
  }, [fetchGlobalExecutions, fetchPendingReviewCount, fetchUnreadMessageCount, fetchHealingIssues]);

  const { filtered: personaExecs } = useFilteredCollection(globalExecutions, {
    exact: [{ field: 'persona_id', value: selectedPersonaId || null }],
  });

  const stats = useMemo(() => {
    const execs = personaExecs;
    const successCount = execs.filter(e => e.status === 'completed').length;
    const successRate = Math.round(resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: successCount, denominator: execs.length },
    ));
    return { successRate, activeAgents: personas.length, recentExecs: execs.slice(0, 12) };
  }, [personaExecs, personas]);

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
            setOverviewTab={setOverviewTab}
          />
        }
      />

      <ContentBody centered>
        <div className="space-y-6 pb-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-2">
            <div>
              <motion.h2
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`${IS_MOBILE ? 'text-xl' : 'text-3xl'} font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent`}
              >
                {greeting}, {displayName}
              </motion.h2>
              <p className="text-muted-foreground/80 mt-1">
                You have <span className="text-primary font-medium">{pendingReviewCount} pending reviews</span> requiring attention.
              </p>
            </div>
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
          </div>

          {IS_MOBILE && <RemoteControlCard />}
          <MemoryActionsPanel actions={memoryActions} onDismiss={dismissMemoryAction} />
          <FleetOptimizationCard />

          <div className="grid grid-cols-1 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
            <RecentActivityList recentExecs={stats.recentExecs} onViewAll={() => setOverviewTab('executions')} />

            <div className="space-y-6">
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
