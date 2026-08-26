// Mission Control — the one consolidated monitoring surface (2026-08-25).
// Vitals (success ring, KPI tiles, sparkline, daily success-rate trend),
// status monitor (from the former Health→Status Page), leaderboard matrix
// (from the former Leaderboard tab), self-healing panel (from Health→
// Heartbeats), execution heatmap, status ticker, memory suggestions, and
// routine/vault cards. The former Instruments / Todos / Stream panes and the
// Reliability (SLA), Health and Leaderboard tabs were consolidated into this
// view — triage counts live on as the Vitals alert/review tiles.

import { Suspense, useMemo, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useAttention } from '@/hooks/useAttention';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { ContentBox, ContentBody, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { StalenessIndicator } from '@/features/shared/components/feedback/StalenessIndicator';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/libs/metricIdentity';
import { MemoryActionsPanel } from '@/features/overview/sub_memories/components/MemoryActionCard';
import { ExecutionHeatmap } from '@/features/overview/sub_analytics/components/ExecutionHeatmap';
import { DailyTrendChart } from '@/features/overview/sub_sla/components/SLACard';
import { HealingEffectivenessPanel } from '@/features/overview/sub_health/components/heartbeats/HealingEffectivenessPanel';
import { DashboardRangeSwitch } from '@/features/overview/components/dashboard/widgets/DashboardRangeSwitch';
import { lazyRetry } from '@/lib/lazyRetry';
import { DeferUntilIdle } from '@/features/shared/components/layout/DeferUntilIdle';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { fadeUp, staggerContainer } from '@/features/overview/libs/animations';
import { DashboardEmptyState } from '@/features/overview/components/dashboard/DashboardEmptyState';
import { HomeCustomizePopover } from '@/features/overview/components/dashboard/HomeCustomizePopover';
import FleetOptimizationCard from './cards/FleetOptimizationCard';
import { PaneHeader } from './PaneHeader';
import { VitalsConsole } from './VitalsConsole';
import { StatusTicker } from './StatusTicker';
import { MissionStatusMonitor } from './sections/MissionStatusMonitor';
import { LeaderboardSection } from './sections/LeaderboardSection';

const UpcomingRoutinesCard = lazyRetry(() => import('./cards/UpcomingRoutinesCard'));
const VaultActivityCard = lazyRetry(() => import('./cards/VaultActivityCard'));

// Suspense fallback for the lazy routine/vault cards — delayed-invisible
// silhouette (docs/design/overview-loading.md §D): a warm chunk never paints it.
function CardFrameSkeleton({ rows = 4, rowHeight = 40 }: { rows?: number; rowHeight?: number }) {
  return (
    <div
      className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden animate-fade-in"
      style={{ animationDelay: '150ms' }}
      aria-hidden="true"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <span className="h-3 w-24 rounded bg-primary/[0.06]" />
        <span className="h-3 w-3 rounded-full bg-primary/[0.06]" />
      </div>
      <ListSkeleton calm rows={rows} rowHeight={rowHeight} leading={false} />
    </div>
  );
}

export default function MissionControlHome() {
  const { t, tx } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const personas = useAgentStore((s) => s.personas);
  const {
    globalExecutions, globalExecutionCounts, memoryActions, executionDashboard,
    observabilityMetrics, pipelineErrors, pipelineFetchedAt, setOverviewTab,
    dismissMemoryAction, setPipelineError,
  } = useOverviewStore(useShallow((s) => ({
    globalExecutions: s.globalExecutions,
    globalExecutionCounts: s.globalExecutionCounts,
    memoryActions: s.memoryActions,
    executionDashboard: s.executionDashboard,
    observabilityMetrics: s.observabilityMetrics,
    pipelineErrors: s.pipelineErrors,
    pipelineFetchedAt: s.pipelineFetchedAt,
    setOverviewTab: s.setOverviewTab,
    dismissMemoryAction: s.dismissMemoryAction,
    setPipelineError: s.setPipelineError,
  })));
  const { counts: attention } = useAttention("dashboard");
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId } = useOverviewFilterActions();
  const hiddenSections = useSystemStore((s) => s.homeHiddenSections);

  const personaName = useMemo(
    () => personas.find((p) => p.id === selectedPersonaId)?.name ?? null,
    [personas, selectedPersonaId],
  );

  const stats = useMemo(() => {
    const execs = selectedPersonaId
      ? globalExecutions.filter((e) => e.persona_id === selectedPersonaId)
      : globalExecutions;
    const successCount = execs.filter((e) => e.status === 'completed').length;
    const successRate = Math.round(resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: successCount, denominator: execs.length },
    ));
    return { successRate, activeAgents: personas.length };
  }, [globalExecutions, personas, selectedPersonaId]);

  // Persona-scoped upgrade path: when a persona is selected, the pipeline's
  // observabilityMetrics carry the accurate full-period numbers; fleet view
  // uses executionDashboard daily points. Same fetch, no duplicates.
  const vitals = useMemo(() => {
    const fleetPoints = executionDashboard?.daily_points ?? [];
    if (!selectedPersonaId || !observabilityMetrics) {
      return { successRate: stats.successRate, points: fleetPoints };
    }
    const summary = observabilityMetrics.summary;
    const successRate = Math.round(resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: summary.successfulExecutions, denominator: summary.totalExecutions },
    ));
    const points = observabilityMetrics.chartData.chart_points.map((p) => ({
      date: p.date, total_executions: p.executions, failed: p.failed,
    }));
    return { successRate, points };
  }, [selectedPersonaId, observabilityMetrics, executionDashboard, stats.successRate]);

  // Daily success-rate trend for the Vitals pane, derived from the SAME daily
  // points the sparkline draws — zero extra fetches. DailyTrendChart expects
  // a 0–1 fraction (SLA convention).
  const successTrendPoints = useMemo(
    () => vitals.points.map((p) => ({
      date: p.date,
      success_rate: p.total_executions > 0
        ? (p.total_executions - p.failed) / p.total_executions
        : 0,
      total: p.total_executions,
    })),
    [vitals.points],
  );

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t.overview.dashboard.greeting_morning;
    if (hour < 18) return t.overview.dashboard.greeting_afternoon;
    return t.overview.dashboard.greeting_evening;
  }, [t]);

  const displayName = user?.display_name || user?.email?.split('@')[0] || t.overview.dashboard.default_user;
  const pipelineErrorCount = Object.keys(pipelineErrors).length;

  const syncedTimestamps = Object.values(pipelineFetchedAt).filter(Boolean);
  const lastSyncedIso = syncedTimestamps.length > 0 ? Math.max(...syncedTimestamps) : undefined;
  const lastSyncedLabel = lastSyncedIso
    ? new Date(lastSyncedIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  const isEmpty = personas.length === 0 && globalExecutions.length === 0;
  const reduceMotion = useReducedMotion();
  const enterInitial = reduceMotion ? false : 'hidden';

  const goToExecutions = useCallback(() => setOverviewTab('executions'), [setOverviewTab]);

  return (
    <ContentBox>
      <HeroMesh preset="dashboard" />

      <ContentHeader
        title={t.overview.dashboard.mission_control_eyebrow}
        subtitle={`${greeting}, ${displayName}`}
        actions={
          <div className="flex items-center gap-2">
            <HomeCustomizePopover />
            <DashboardRangeSwitch />
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
          </div>
        }
      />

      <ContentBody centered>
        <motion.div
          className="space-y-4 pb-6 pt-2"
          variants={staggerContainer}
          initial={enterInitial}
          animate="visible"
        >
          {pipelineErrorCount > 0 && (
            <motion.div variants={fadeUp} className="space-y-2">
              {Object.entries(pipelineErrors).map(([source, msg]) => (
                <InlineErrorBanner
                  key={source}
                  severity="warning"
                  compact
                  title={tx(t.overview.dashboard.pipeline_failed, { source })}
                  message={msg}
                  onDismiss={() => setPipelineError(source, null)}
                  actions={<StalenessIndicator fetchedAt={pipelineFetchedAt[source]} hasError label={source} />}
                />
              ))}
            </motion.div>
          )}

          {!hiddenSections.includes('fleet') && (
            <motion.div variants={fadeUp}>
              <FleetOptimizationCard />
            </motion.div>
          )}

          <motion.div variants={fadeUp}>
            {isEmpty ? (
              <DashboardEmptyState />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-4">
                <VitalsConsole
                  successRate={vitals.successRate}
                  activeAgents={stats.activeAgents}
                  activeAlertCount={attention.active_alerts}
                  totalExecutions={globalExecutionCounts.total}
                  pendingReviews={attention.pending_reviews}
                  points={vitals.points}
                  personaName={personaName}
                  trend={successTrendPoints.length > 0 && (
                    <div className="w-full pt-3 border-t border-primary/10">
                      <div className="flex items-center justify-between typo-caption uppercase tracking-widest text-foreground mb-1.5 font-mono">
                        <span>{t.overview.sla.success_rate}</span>
                        <span>{successTrendPoints.length}d</span>
                      </div>
                      <DailyTrendChart points={successTrendPoints} />
                    </div>
                  )}
                />
                <MissionStatusMonitor />
              </div>
            )}
          </motion.div>

          {!isEmpty && (
            <motion.div variants={fadeUp}>
              <LeaderboardSection />
            </motion.div>
          )}

          <motion.div variants={fadeUp}>
            <StatusTicker
              pipelineSources={Object.keys(pipelineFetchedAt).length}
              pipelineErrors={pipelineErrorCount}
              totalExecutions={globalExecutionCounts.total}
              lastSyncedLabel={lastSyncedLabel}
              onNavigate={setOverviewTab}
            />
          </motion.div>

          <DeferUntilIdle priority="next-frame">
            <motion.div
              className="space-y-4"
              variants={staggerContainer}
              initial={enterInitial}
              animate="visible"
            >
              {!isEmpty && (
                <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {!hiddenSections.includes('heatmap') ? (
                    <ExecutionHeatmap
                      personaId={selectedPersonaId || undefined}
                      onDayClick={goToExecutions}
                    />
                  ) : <span />}
                  <HealingEffectivenessPanel />
                </motion.div>
              )}

              {memoryActions.length > 0 && !hiddenSections.includes('memory') && (
                <motion.div variants={fadeUp} className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
                  <PaneHeader label={t.overview.dashboard.pane_memory} subtitle={tx(t.overview.dashboard.memory_suggestions_count, { count: memoryActions.length })} />
                  <div className="p-3">
                    <MemoryActionsPanel actions={memoryActions} onDismiss={dismissMemoryAction} />
                  </div>
                </motion.div>
              )}

              {!isEmpty && !hiddenSections.includes('routines') && (
                <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Suspense fallback={<CardFrameSkeleton rows={3} rowHeight={44} />}>
                    <UpcomingRoutinesCard />
                  </Suspense>
                  <Suspense fallback={<CardFrameSkeleton rows={4} rowHeight={32} />}>
                    <VaultActivityCard />
                  </Suspense>
                </motion.div>
              )}
            </motion.div>
          </DeferUntilIdle>
        </motion.div>
      </ContentBody>
    </ContentBox>
  );
}
