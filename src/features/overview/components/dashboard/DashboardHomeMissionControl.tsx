// Prototype variant — "Mission Control"
//
// Metaphor: operator's cockpit. Three fixed panes (Triage / Vitals / Stream)
// + a bottom status strip. Dense, one-screen, no ambient motion.
// Typography leans on typo-label + mono accents for numeric / id readouts.
//
// Labels like "TRIAGE", "VITALS", "STREAM", "STATUS" are prototype-only;
// they'll be extracted to i18n only if this direction wins.

import { Suspense, useMemo, useState, useEffect, useCallback, memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ClipboardCheck, AlertTriangle, Activity, Cpu, Bell,
  CheckCircle2, AlertCircle, ArrowRight,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import type { OverviewTab } from '@/lib/types/types';
import { getOverviewBundle } from '@/api/overview/observability';
import type { OverviewBundle } from '@/lib/bindings/OverviewBundle';
import { silentCatch } from '@/lib/silentCatch';
import { useAttention } from '@/hooks/useAttention';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { ContentBox, ContentBody, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import { KpiTile, type KpiTrend } from '@/features/overview/components/shared/KpiTile';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { StalenessIndicator } from '@/features/shared/components/feedback/StalenessIndicator';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/libs/metricIdentity';
import ResumeSetupCard from '@/features/overview/components/dashboard/cards/ResumeSetupCard';
import FleetOptimizationCard from '@/features/overview/components/dashboard/cards/FleetOptimizationCard';
import { MemoryActionsPanel } from '@/features/overview/sub_memories/components/MemoryActionCard';
import { TrafficErrorsChart } from './widgets/TrafficErrorsChart';
import { DashboardRangeSwitch } from './widgets/DashboardRangeSwitch';
import { TopPerformersWidget } from './widgets/TopPerformersWidget';
import { ExecutionHeatmap } from '@/features/overview/sub_analytics/components/ExecutionHeatmap';
import { lazyRetry } from '@/lib/lazyRetry';
import { DeferUntilIdle } from '@/features/shared/components/layout/DeferUntilIdle';
import { fadeUp, staggerContainer } from '@/features/overview/libs/animations';
import { DashboardEmptyState } from './DashboardEmptyState';
import { HomeCustomizePopover } from './HomeCustomizePopover';
import { DebtText } from '@/i18n/DebtText';


const AnalyticsInserts = lazyRetry(() => import('./widgets/AnalyticsInserts'));
const UpcomingRoutinesCard = lazyRetry(() => import('./cards/UpcomingRoutinesCard'));
const VaultRecentChangesCard = lazyRetry(() => import('./cards/VaultRecentChangesCard'));

type TriageKind = 'alert' | 'pipeline' | 'review' | 'message';
interface TriageItem {
  id: string;
  kind: TriageKind;
  title: string;
  detail?: string;
  onClick: () => void;
}

export default function DashboardHomeMissionControl() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const personas = useAgentStore((s) => s.personas);
  const {
    globalExecutions, globalExecutionCounts, memoryActions, executionDashboard,
    executionDashboardDays, pipelineErrors, pipelineFetchedAt, setOverviewTab,
    dismissMemoryAction, setPipelineError,
  } = useOverviewStore(useShallow((s) => ({
    globalExecutions: s.globalExecutions,
    // Use the authoritative server-side counts for any "total executions"
    // display. The slice's `globalExecutionsHasMore` is a pagination hint,
    // not a row count, and previously misnamed `globalExecutionsTotal` was
    // being passed to UIs that wanted the real total.
    globalExecutionCounts: s.globalExecutionCounts,
    memoryActions: s.memoryActions,
    executionDashboard: s.executionDashboard,
    executionDashboardDays: s.executionDashboardDays,
    pipelineErrors: s.pipelineErrors,
    pipelineFetchedAt: s.pipelineFetchedAt,
    setOverviewTab: s.setOverviewTab,
    dismissMemoryAction: s.dismissMemoryAction,
    setPipelineError: s.setPipelineError,
  })));
  const { counts: attention } = useAttention("dashboard");
  const pendingReviewCount = attention.pending_reviews;
  const unreadMessageCount = attention.unread_messages;
  const activeAlertCount = attention.active_alerts;
  const { selectedPersonaId } = useOverviewFilterValues();
  const { setSelectedPersonaId } = useOverviewFilterActions();
  const hiddenSections = useSystemStore((s) => s.homeHiddenSections);

  // Mission Control panes that derive from the loaded execution feed honour
  // the header persona filter; fleet-wide aggregates (KPI tiles, traffic
  // sparkline, triage counts) stay global and carry a <FleetTag/> so the mixed
  // scope is never ambiguous. Stage 2 gives those aggregates their own
  // persona-scoped backend query.
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
    return { successRate, activeAgents: personas.length, recentExecs: execs.slice(0, 20) };
  }, [globalExecutions, personas, selectedPersonaId]);

  // Stage 2 — when a persona is selected, pull that persona's accurate metrics
  // from get_overview_bundle (already persona-aware on the backend) so the
  // Vitals success ring and traffic sparkline reflect the full period instead
  // of the rough recent-feed estimate. The 4 KPI tiles and Triage stay
  // fleet-wide — those need per-persona attention queries (a later stage).
  const [personaMetrics, setPersonaMetrics] = useState<OverviewBundle | null>(null);
  useEffect(() => {
    if (!selectedPersonaId) { setPersonaMetrics(null); return; }
    let cancelled = false;
    setPersonaMetrics(null);
    getOverviewBundle(executionDashboardDays ?? 30, selectedPersonaId)
      .then((bundle) => { if (!cancelled) setPersonaMetrics(bundle); })
      .catch(silentCatch('DashboardHomeMissionControl:personaMetrics'));
    return () => { cancelled = true; };
  }, [selectedPersonaId, executionDashboardDays]);

  const vitals = useMemo(() => {
    const fleetPoints = executionDashboard?.daily_points ?? [];
    if (!selectedPersonaId || !personaMetrics) {
      return { successRate: stats.successRate, points: fleetPoints };
    }
    const summary = personaMetrics.metricsSummary;
    const successRate = Math.round(resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: summary.successfulExecutions, denominator: summary.totalExecutions },
    ));
    const points = personaMetrics.metricsChartData.chart_points.map((p) => ({
      date: p.date, total_executions: p.executions, failed: p.failed,
    }));
    return { successRate, points };
  }, [selectedPersonaId, personaMetrics, executionDashboard, stats.successRate]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t.overview.dashboard.greeting_morning;
    if (hour < 18) return t.overview.dashboard.greeting_afternoon;
    return t.overview.dashboard.greeting_evening;
  }, [t]);

  const displayName = user?.display_name || user?.email?.split('@')[0] || t.overview.dashboard.default_user;

  const pipelineErrorCount = Object.keys(pipelineErrors).length;

  // Triage is a ranked work queue, not a flat list: items are sorted by
  // urgency (alert → pipeline → review → message). The pane accents whatever
  // lands at rank 0 and the header "Most urgent" button jumps straight to it.
  const triageItems = useMemo<TriageItem[]>(() => {
    const out: TriageItem[] = [];
    if (activeAlertCount > 0) out.push({
      id: 'alerts',
      kind: 'alert',
      title: `${activeAlertCount} ${t.overview.widgets.alerts_badge}`,
      detail: 'active health alerts',
      onClick: () => setOverviewTab('health'),
    });
    if (pipelineErrorCount > 0) out.push({
      id: 'pipelines',
      kind: 'pipeline',
      title: `${pipelineErrorCount} ${t.overview.widgets.pipelines_badge}`,
      detail: t.overview.dashboard.triage_detail_pipelines,
      onClick: () => setOverviewTab('health'),
    });
    if (pendingReviewCount > 0) out.push({
      id: 'reviews',
      kind: 'review',
      title: `${pendingReviewCount} ${t.overview.widgets.reviews_badge}`,
      detail: 'manual review queue',
      onClick: () => setOverviewTab('manual-review'),
    });
    if (unreadMessageCount > 0) out.push({
      id: 'messages',
      kind: 'message',
      title: `${unreadMessageCount} ${t.overview.widgets.messages_badge}`,
      detail: 'unread in inbox',
      onClick: () => setOverviewTab('messages'),
    });
    // Memory suggestions get their own detailed panel in the Instruments bay
    // below — they're richer than the triage summary affords.
    return out.sort((a, b) => TRIAGE_SEVERITY[a.kind] - TRIAGE_SEVERITY[b.kind]);
  }, [activeAlertCount, pipelineErrorCount, pendingReviewCount, unreadMessageCount, t, setOverviewTab]);

  const chartData = useMemo(() => {
    // Scope the Instruments traffic chart to the persona filter when a persona
    // is selected, reusing the same get_overview_bundle data the Vitals
    // sparkline draws from (see the personaMetrics fetch above).
    if (selectedPersonaId && personaMetrics) {
      return personaMetrics.metricsChartData.chart_points.map((p) => ({
        date: p.date, traffic: p.executions, errors: p.failed,
      }));
    }
    const points = executionDashboard?.daily_points ?? [];
    return points.map((p) => ({ date: p.date, traffic: p.total_executions, errors: p.failed }));
  }, [executionDashboard, selectedPersonaId, personaMetrics]);

  const chartTotals = useMemo(() => {
    const totalTraffic = chartData.reduce((s, d) => s + d.traffic, 0);
    const totalErrors = chartData.reduce((s, d) => s + d.errors, 0);
    return { totalTraffic, totalErrors };
  }, [chartData]);

  const lastSyncedIso = Object.values(pipelineFetchedAt).filter(Boolean).sort().pop();
  const lastSyncedLabel = lastSyncedIso
    ? new Date(lastSyncedIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  const isEmpty = personas.length === 0 && globalExecutions.length === 0;

  // Honour the OS reduced-motion setting: skip the entrance cascade entirely
  // (content renders straight at its final state) rather than just shortening it.
  const reduceMotion = useReducedMotion();
  const enterInitial = reduceMotion ? false : 'hidden';

  // Stable handler so the memoized panes below don't re-render on every
  // parent render just because an inline arrow changed identity.
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
            <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
          </div>
        }
      />

      <ContentBody centered>
        {/*
          Initial-load choreography:
          - Above-the-fold panes render in the first commit and cascade in
            via the `staggerContainer` → `fadeUp` variants.
          - Below-the-fold sections (heatmap, instruments, memory, routines)
            are held out of the first DOM commit by `<DeferUntilIdle>` and
            mounted one frame later, then run their own cascade. This keeps
            the first paint to just the header + three panes.
        */}
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
                  title={`${source} pipeline failed`}
                  message={msg}
                  onDismiss={() => setPipelineError(source, null)}
                  actions={<StalenessIndicator fetchedAt={pipelineFetchedAt[source]} hasError label={source} />}
                />
              ))}
            </motion.div>
          )}

          <motion.div variants={fadeUp}>
            <ResumeSetupCard />
          </motion.div>

          <motion.div variants={fadeUp}>
            {isEmpty ? (
              <DashboardEmptyState />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_1fr_minmax(280px,340px)] gap-4">
                <TriagePane items={triageItems} personaScoped={!!personaName} />
                <VitalsConsole
                  successRate={vitals.successRate}
                  activeAgents={stats.activeAgents}
                  activeAlertCount={activeAlertCount}
                  totalExecutions={globalExecutionCounts.total}
                  pendingReviews={pendingReviewCount}
                  points={vitals.points}
                  personaName={personaName}
                />
                <ActivityStreamLog
                  executions={stats.recentExecs}
                  onViewAll={goToExecutions}
                  personaName={personaName}
                />
              </div>
            )}
          </motion.div>

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
              {!isEmpty && !hiddenSections.includes('heatmap') && (
                <motion.div variants={fadeUp}>
                  <ExecutionHeatmap
                    personaId={selectedPersonaId || undefined}
                    onDayClick={goToExecutions}
                  />
                </motion.div>
              )}

              {!isEmpty && !hiddenSections.includes('instruments') && (
                <motion.div variants={fadeUp}>
                  <InstrumentsBay
                    chartData={chartData}
                    chartTotals={chartTotals}
                    executionDashboardFetchedAt={pipelineFetchedAt.executionDashboard}
                    executionDashboardError={!!pipelineErrors.executionDashboard}
                    personaName={personaName}
                    highlightPersonaId={selectedPersonaId}
                  />
                </motion.div>
              )}

              {memoryActions.length > 0 && !hiddenSections.includes('memory') && (
                <motion.div variants={fadeUp} className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
                  <PaneHeader label="Memory" subtitle={`${memoryActions.length} suggestions`} />
                  <div className="p-3">
                    <MemoryActionsPanel actions={memoryActions} onDismiss={dismissMemoryAction} />
                  </div>
                </motion.div>
              )}

              {!hiddenSections.includes('fleet') && (
                <motion.div variants={fadeUp}>
                  <FleetOptimizationCard />
                </motion.div>
              )}

              {!isEmpty && !hiddenSections.includes('routines') && (
                <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Suspense fallback={null}>
                    <UpcomingRoutinesCard />
                  </Suspense>
                  <Suspense fallback={null}>
                    <VaultRecentChangesCard />
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

// ---------------------------------------------------------------------------
// InstrumentsBay — secondary row with Top Performers, Traffic chart, and the
// rotation-overview panel. Mirrors the three-column content the baseline
// renders in its main grid, styled as a cockpit sub-panel.
// ---------------------------------------------------------------------------

export const InstrumentsBay = memo(function InstrumentsBay({
  chartData, chartTotals, executionDashboardFetchedAt, executionDashboardError,
  personaName, highlightPersonaId,
}: {
  chartData: { date: string; traffic: number; errors: number }[];
  chartTotals: { totalTraffic: number; totalErrors: number };
  executionDashboardFetchedAt: number | undefined;
  executionDashboardError: boolean;
  personaName: string | null;
  highlightPersonaId: string | null;
}) {
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <PaneHeader label="Instruments" subtitle="fleet telemetry" />
      <div className="p-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left — leaderboard snapshot */}
        <div>
          <TopPerformersWidget highlightPersonaId={highlightPersonaId} />
        </div>

        {/* Center — traffic chart */}
        <div className="relative">
          <StalenessIndicator
            fetchedAt={executionDashboardFetchedAt}
            hasError={executionDashboardError}
            label="Traffic"
          />
          {personaName && (
            <div className="typo-caption text-foreground mb-1 truncate">{personaName}</div>
          )}
          <TrafficErrorsChart
            chartData={chartData}
            totalTraffic={chartTotals.totalTraffic}
            totalErrors={chartTotals.totalErrors}
            rangeControl={<DashboardRangeSwitch />}
          />
        </div>

        {/* Right — rotation overview */}
        <div className="space-y-4">
          <Suspense fallback={null}>
            <AnalyticsInserts />
          </Suspense>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// TriagePane — ranked queue of items needing the operator's attention
// ---------------------------------------------------------------------------

// Lower rank = more urgent. Drives the triage queue sort + the rank-0 accent.
const TRIAGE_SEVERITY: Record<TriageKind, number> = {
  alert: 0, pipeline: 1, review: 2, message: 3,
};

const TRIAGE_META: Record<TriageKind, { Icon: typeof ClipboardCheck; color: string; bg: string; border: string; tag: string }> = {
  alert:    { Icon: AlertTriangle,  color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    tag: 'ALT' },
  pipeline: { Icon: AlertCircle,    color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', tag: 'SYS' },
  review:   { Icon: ClipboardCheck, color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20',  tag: 'REV' },
  message:  { Icon: Bell,           color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   tag: 'MSG' },
};

export const TriagePane = memo(function TriagePane({
  items, personaScoped,
}: { items: TriageItem[]; personaScoped: boolean }) {
  const { t, tx } = useTranslation();
  const topItem = items[0];
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <PaneHeader
        label={t.overview.dashboard.todos_label}
        subtitle={tx(t.overview.dashboard.todos_subtitle_open, { count: items.length })}
      >
        <div className="flex items-center gap-2">
          {personaScoped && <FleetTag />}
          {topItem && (
            <button
              onClick={topItem.onClick}
              className="typo-caption font-mono uppercase tracking-widest text-primary/80 hover:text-primary transition-colors flex items-center gap-1"
            >
              {t.overview.dashboard.triage_jump} <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </PaneHeader>
      <div className="flex-1 divide-y divide-primary/5 max-h-[28rem] overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState variant="todos" heading={t.overview.dashboard.todos_empty} dominant className="flex-1 py-8" />
        ) : (
          items.map((item, idx) => {
            const meta = TRIAGE_META[item.kind];
            const Icon = meta.Icon;
            const isTop = idx === 0;
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left border-l-2 transition-colors group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 ${
                  isTop
                    ? `${meta.border} bg-primary/[0.04] hover:bg-primary/[0.07]`
                    : 'border-transparent hover:bg-primary/[0.04]'
                }`}
              >
                <span className={`typo-caption font-mono px-1.5 py-0.5 rounded-interactive border ${meta.bg} ${meta.border} ${meta.color} flex-shrink-0`}>
                  {meta.tag}
                </span>
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${meta.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="typo-body text-foreground truncate">{item.title}</div>
                  {item.detail && (
                    <div className="typo-caption text-foreground truncate">{item.detail}</div>
                  )}
                </div>
                {isTop && (
                  <span className="typo-caption font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-interactive bg-primary/10 text-primary flex-shrink-0">
                    {t.overview.dashboard.triage_up_next}
                  </span>
                )}
                <ArrowRight className="w-3.5 h-3.5 text-foreground group-hover:text-foreground/70 transition-colors flex-shrink-0" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// VitalsConsole — central pane: success ring + four big readouts + sparkline
// ---------------------------------------------------------------------------

export const VitalsConsole = memo(function VitalsConsole({
  successRate, activeAgents, activeAlertCount, totalExecutions, pendingReviews, points, personaName,
}: {
  successRate: number;
  activeAgents: number;
  activeAlertCount: number;
  totalExecutions: number;
  pendingReviews: number;
  points: { date: string; total_executions: number; failed: number }[];
  personaName: string | null;
}) {
  const { language } = useTranslation();

  // Recent-momentum delta for the Runs tile: compare the back half of the
  // selected window against the front half. Gives the cumulative total a
  // direction-of-travel signal without a backend period-comparison query.
  const runsTrend = useMemo<KpiTrend | null>(() => {
    if (points.length < 4) return null;
    const mid = Math.floor(points.length / 2);
    const sum = (arr: typeof points) => arr.reduce((s, p) => s + p.total_executions, 0);
    const prev = sum(points.slice(0, mid));
    const recent = sum(points.slice(mid));
    if (prev === 0) return null;
    return { pct: ((recent - prev) / prev) * 100, invertColor: false };
  }, [points]);

  // Build a tiny static sparkline of traffic vs errors for context. The traffic
  // series gets a gradient-filled area (so the pane's only chart reads as
  // finished, not a bare polyline); errors stay a thin overlaid line. Both
  // series mark their latest value with an end dot.
  const sparkline = useMemo(() => {
    if (!points.length) return null;
    const max = Math.max(...points.map((p) => p.total_executions), 1);
    const w = 200, h = 40;
    const pad = 2; // keep end dots + stroke off the top/bottom edge
    const step = w / Math.max(points.length - 1, 1);
    const toY = (v: number) => h - pad - (v / max) * (h - pad * 2);
    const xy = (v: number, i: number) => ({ x: i * step, y: toY(v) });
    const trafficPts = points.map((p, i) => xy(p.total_executions, i));
    const errorPts = points.map((p, i) => xy(p.failed, i));
    const toStr = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y.toFixed(1)}`).join(' ');
    const lastX = (points.length - 1) * step;
    const area = `M0,${h} L${toStr(trafficPts).replace(/ /g, ' L')} L${lastX},${h} Z`;
    return {
      traffic: toStr(trafficPts),
      errors: toStr(errorPts),
      area,
      trafficEnd: trafficPts[trafficPts.length - 1]!,
      errorEnd: errorPts[errorPts.length - 1]!,
      w, h,
    };
  }, [points]);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <PaneHeader label="Vitals" subtitle={personaName ?? 'fleet health'} />
      <div className="flex-1 flex flex-col items-center gap-5 px-4 py-6">
        <SuccessRing rate={successRate} />
        <div className="w-full space-y-2">
          {personaName && (
            <div className="flex justify-end">
              <FleetTag />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <KpiTile density="console" icon={<Activity className="w-3.5 h-3.5" />} label="Runs" numericValue={totalExecutions} compact language={language} color="text-emerald-400" trend={runsTrend} />
            <KpiTile density="console" icon={<Cpu className="w-3.5 h-3.5" />} label="Agents" numericValue={activeAgents} color="text-violet-400" />
            <KpiTile density="console" icon={<Bell className="w-3.5 h-3.5" />} label="Alerts" numericValue={activeAlertCount} color={activeAlertCount > 0 ? 'text-red-400' : 'text-foreground'} />
            <KpiTile density="console" icon={<ClipboardCheck className="w-3.5 h-3.5" />} label="Reviews" numericValue={pendingReviews} color={pendingReviews > 0 ? 'text-amber-400' : 'text-foreground'} />
          </div>
        </div>
        {sparkline && (
          <div className="w-full pt-3 border-t border-primary/10">
            <div className="flex items-center justify-between typo-caption uppercase tracking-widest text-foreground mb-1.5 font-mono">
              <span><DebtText k="auto_traffic_errors_7c114a11" /></span>
              <span>{points.length}d</span>
            </div>
            <svg viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} className="w-full h-10" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="vitals-spark-traffic" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* baseline */}
              <line x1="0" y1={sparkline.h - 2} x2={sparkline.w} y2={sparkline.h - 2} stroke="currentColor" className="text-primary/10" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <path d={sparkline.area} fill="url(#vitals-spark-traffic)" stroke="none" />
              <polyline fill="none" stroke="#06b6d4" strokeWidth="1.5" points={sparkline.traffic} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              <polyline fill="none" stroke="#f43f5e" strokeWidth="1.5" points={sparkline.errors} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={sparkline.trafficEnd.x} cy={sparkline.trafficEnd.y} r="2" fill="#06b6d4" />
              <circle cx={sparkline.errorEnd.x} cy={sparkline.errorEnd.y} r="2" fill="#f43f5e" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
});

function SuccessRing({ rate }: { rate: number }) {
  const size = 164;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (rate / 100) * c;
  const color = rate >= 90 ? '#34d399' : rate >= 75 ? '#fbbf24' : '#fb7185';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={stroke} fill="none" className="text-primary/10" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-mono text-4xl tabular-nums text-foreground">
          <AnimatedCounter value={rate} formatFn={(v) => `${Math.round(v)}`} />
          <span className="text-foreground typo-body-lg">%</span>
        </div>
        <div className="typo-caption uppercase tracking-[0.25em] text-foreground mt-1 font-mono">
          success
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityStreamLog — mono-styled execution log
// ---------------------------------------------------------------------------

type StreamFilter = 'all' | 'completed' | 'failed' | 'running';
const STREAM_FILTERS: StreamFilter[] = ['all', 'completed', 'failed', 'running'];

// Buckets a raw execution status into a filterable group. Anything that isn't
// a terminal completed/failed counts as "running" (queued, active, …).
function streamBucket(status: string): 'completed' | 'failed' | 'running' {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'running';
}

export const ActivityStreamLog = memo(function ActivityStreamLog({
  executions, onViewAll, personaName,
}: {
  executions: { id: string; status: string; persona_name?: string; created_at: string }[];
  onViewAll: () => void;
  personaName: string | null;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<StreamFilter>('all');
  const filtered = filter === 'all'
    ? executions
    : executions.filter((e) => streamBucket(e.status) === filter);
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <PaneHeader
        label="Stream"
        subtitle={personaName ? `${personaName} · ${executions.length}` : `${executions.length} events`}
      >
        <button
          onClick={onViewAll}
          className="typo-caption text-primary/80 hover:text-primary transition-colors flex items-center gap-1 font-mono uppercase tracking-widest"
        >
          {t.overview.widgets.view_all} <ArrowRight className="w-3 h-3" />
        </button>
      </PaneHeader>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-primary/10 flex-shrink-0">
        {STREAM_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`typo-caption font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-interactive transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 ${
              filter === f ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-primary/[0.06]'
            }`}
          >
            {f === 'all' ? t.common.all : tokenLabel(t, 'execution', f)}
          </button>
        ))}
      </div>
      <div className="flex-1 divide-y divide-primary/5 max-h-[28rem] overflow-y-auto font-mono text-xs">
        {filtered.length === 0 ? (
          <EmptyState variant="stream" dominant className="flex-1 py-8" />
        ) : (
          filtered.map((exec) => {
            const time = new Date(exec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const color =
              exec.status === 'completed' ? 'text-emerald-400' :
              exec.status === 'failed' ? 'text-rose-400' :
              'text-blue-400';
            const Icon =
              exec.status === 'completed' ? CheckCircle2 :
              exec.status === 'failed' ? AlertCircle :
              Activity;
            return (
              <button
                key={exec.id}
                onClick={onViewAll}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-primary/[0.04] transition-colors"
              >
                <span className="text-foreground tabular-nums flex-shrink-0">{time}</span>
                <Icon className={`w-3 h-3 flex-shrink-0 ${color}`} />
                <span className="text-foreground/90 truncate flex-1 min-w-0 font-sans typo-body">
                  {exec.persona_name || 'agent'}
                </span>
                <span className={`${color} uppercase flex-shrink-0`}>{exec.status.slice(0, 4)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// StatusTicker — bottom strip with pipeline metadata
// ---------------------------------------------------------------------------

export const StatusTicker = memo(function StatusTicker({
  pipelineSources, pipelineErrors, totalExecutions, lastSyncedLabel, onNavigate,
}: {
  pipelineSources: number;
  pipelineErrors: number;
  totalExecutions: number;
  lastSyncedLabel: string;
  onNavigate: (tab: OverviewTab) => void;
}) {
  const fieldCls = 'flex items-center gap-1.5 typo-caption font-mono uppercase tracking-widest';
  // errors / runs / synced are shortcuts into the tab that owns each metric;
  // "sources" stays inert — it has no single dedicated destination.
  const linkCls = `${fieldCls} text-foreground rounded-interactive px-1 -mx-1 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30`;
  return (
    <div className="rounded-card border border-primary/10 bg-primary/[0.03] px-4 py-2 flex items-center gap-5 overflow-x-auto">
      <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground flex-shrink-0">status</span>
      <div className={`${fieldCls} text-foreground`}>
        <span className="text-foreground">sources</span>
        <span className="text-foreground tabular-nums">{pipelineSources}</span>
      </div>
      <button type="button" onClick={() => onNavigate('health')} className={linkCls}>
        <span>errors</span>
        <span className={`tabular-nums ${pipelineErrors > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{pipelineErrors}</span>
      </button>
      <button type="button" onClick={() => onNavigate('executions')} className={linkCls}>
        <span>runs</span>
        <span className="tabular-nums">{totalExecutions.toLocaleString()}</span>
      </button>
      <button type="button" onClick={() => onNavigate('observability')} className={`${linkCls} ml-auto flex-shrink-0`}>
        <span>synced</span>
        <span className="tabular-nums">{lastSyncedLabel}</span>
      </button>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Shared pane header
// ---------------------------------------------------------------------------

function PaneHeader({
  label, subtitle, children,
}: { label: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
      <div className="flex items-baseline gap-2">
        <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground">{label}</span>
        {subtitle && (
          <span className="typo-caption text-foreground">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// Small chip marking a pane (or sub-section) as fleet-wide — its data ignores
// the header persona filter. Rendered wherever Mission Control mixes
// persona-scoped and fleet-scoped readouts so the boundary stays visible.
function FleetTag() {
  const { t } = useTranslation();
  return (
    <span
      title={t.overview.dashboard.scope_fleet_hint}
      className="typo-caption font-mono uppercase tracking-widest px-1.5 py-0.5 rounded-interactive border border-primary/15 bg-primary/[0.04] text-foreground flex-shrink-0"
    >
      {t.overview.dashboard.scope_fleet}
    </span>
  );
}
