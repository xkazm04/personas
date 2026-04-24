// Prototype variant — "Mission Control"
//
// Metaphor: operator's cockpit. Three fixed panes (Triage / Vitals / Stream)
// + a bottom status strip. Dense, one-screen, no ambient motion.
// Typography leans on typo-label + mono accents for numeric / id readouts.
//
// Labels like "TRIAGE", "VITALS", "STREAM", "STATUS" are prototype-only;
// they'll be extracted to i18n only if this direction wins.

import { Suspense, useMemo, useCallback } from 'react';
import {
  ClipboardCheck, AlertTriangle, Activity, Cpu, Bell,
  CheckCircle2, AlertCircle, ArrowRight,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { selectActiveAlertCount } from '@/stores/selectors/activeAlertCount';
import { useOverviewFilterValues, useOverviewFilterActions } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { ContentBox, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { HeroMesh } from '@/features/shared/components/display/HeroMesh';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { StalenessIndicator } from '@/features/shared/components/feedback/StalenessIndicator';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import ResumeSetupCard from '@/features/overview/components/dashboard/cards/ResumeSetupCard';
import FleetOptimizationCard from '@/features/overview/components/dashboard/cards/FleetOptimizationCard';
import { HealthDigestPanel } from '@/features/agents/health';
import { MemoryActionsPanel } from '@/features/overview/sub_memories/components/MemoryActionCard';
import { TrafficErrorsChart } from './widgets/TrafficErrorsChart';
import { TopPerformersWidget } from './widgets/TopPerformersWidget';
import { lazyRetry } from '@/lib/lazyRetry';
import { DashboardEmptyState } from './DashboardEmptyState';

const AnalyticsInserts = lazyRetry(() => import('./widgets/AnalyticsInserts'));
const UpcomingRoutinesCard = lazyRetry(() => import('./cards/UpcomingRoutinesCard'));
const VaultRecentChangesCard = lazyRetry(() => import('./cards/VaultRecentChangesCard'));

type TriageKind = 'review' | 'alert';
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

  const stats = useMemo(() => {
    const execs = globalExecutions;
    const successCount = execs.filter((e) => e.status === 'completed').length;
    const successRate = Math.round(resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: successCount, denominator: execs.length },
    ));
    return { successRate, activeAgents: personas.length, recentExecs: execs.slice(0, 20) };
  }, [globalExecutions, personas]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t.overview.dashboard.greeting_morning;
    if (hour < 18) return t.overview.dashboard.greeting_afternoon;
    return t.overview.dashboard.greeting_evening;
  }, [t]);

  const displayName = user?.display_name || user?.email?.split('@')[0] || t.overview.dashboard.default_user;

  const triageItems = useMemo<TriageItem[]>(() => {
    const out: TriageItem[] = [];
    if (pendingReviewCount > 0) out.push({
      id: 'reviews',
      kind: 'review',
      title: `${pendingReviewCount} ${t.overview.widgets.reviews_badge}`,
      detail: 'manual review queue',
      onClick: () => setOverviewTab('manual-review'),
    });
    if (activeAlertCount > 0) out.push({
      id: 'alerts',
      kind: 'alert',
      title: `${activeAlertCount} ${t.overview.widgets.alerts_badge}`,
      detail: 'active health alerts',
      onClick: () => setOverviewTab('health'),
    });
    if (unreadMessageCount > 0) out.push({
      id: 'messages',
      kind: 'review',
      title: `${unreadMessageCount} ${t.overview.widgets.messages_badge}`,
      detail: 'unread in inbox',
      onClick: () => setOverviewTab('messages'),
    });
    // Memory suggestions get their own detailed panel in the Instruments bay
    // below — they're richer than the triage summary affords.
    return out;
  }, [pendingReviewCount, activeAlertCount, unreadMessageCount, t, setOverviewTab]);

  const chartData = useMemo(() => {
    const points = executionDashboard?.daily_points ?? [];
    return points.map((p) => ({ date: p.date, traffic: p.total_executions, errors: p.failed }));
  }, [executionDashboard]);

  const chartTotals = useMemo(() => {
    const totalTraffic = chartData.reduce((s, d) => s + d.traffic, 0);
    const totalErrors = chartData.reduce((s, d) => s + d.errors, 0);
    return { totalTraffic, totalErrors };
  }, [chartData]);

  const pipelineErrorCount = Object.keys(pipelineErrors).length;
  const lastSyncedIso = Object.values(pipelineFetchedAt).filter(Boolean).sort().pop();
  const lastSyncedLabel = lastSyncedIso
    ? new Date(lastSyncedIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  const isEmpty = personas.length === 0 && globalExecutions.length === 0;

  return (
    <ContentBox>
      <HeroMesh preset="dashboard" />

      {/* Thin mono-accented header */}
      <div className="relative px-4 md:px-6 xl:px-8 py-4 border-b border-primary/10 bg-primary/5 flex-shrink-0 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="typo-caption uppercase tracking-[0.3em] text-foreground/50 font-mono">
            Mission Control
          </div>
          <h1 className="typo-heading-lg text-foreground mt-0.5">
            {greeting}, {displayName}
          </h1>
        </div>
        <PersonaSelect value={selectedPersonaId} onChange={setSelectedPersonaId} personas={personas} />
      </div>

      <ContentBody centered>
        <div className="space-y-4 pb-6 pt-2">

          {pipelineErrorCount > 0 && (
            <div className="space-y-2">
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
            </div>
          )}

          <ResumeSetupCard />

          {isEmpty ? (
            <DashboardEmptyState />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_1fr_minmax(280px,340px)] gap-4">
              <TriagePane items={triageItems} />
              <VitalsConsole
                successRate={stats.successRate}
                activeAgents={stats.activeAgents}
                activeAlertCount={activeAlertCount}
                totalExecutions={globalExecutionsTotal}
                pendingReviews={pendingReviewCount}
                points={executionDashboard?.daily_points ?? []}
              />
              <ActivityStreamLog
                executions={stats.recentExecs}
                onViewAll={() => setOverviewTab('executions')}
              />
            </div>
          )}

          <StatusTicker
            pipelineSources={Object.keys(pipelineFetchedAt).length}
            pipelineErrors={pipelineErrorCount}
            totalExecutions={globalExecutionsTotal}
            lastSyncedLabel={lastSyncedLabel}
          />

          {!isEmpty && (
            <InstrumentsBay
              chartData={chartData}
              chartTotals={chartTotals}
              executionDashboardFetchedAt={pipelineFetchedAt.executionDashboard}
              executionDashboardError={!!pipelineErrors.executionDashboard}
            />
          )}

          {memoryActions.length > 0 && (
            <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
              <PaneHeader label="Memory" subtitle={`${memoryActions.length} suggestions`} />
              <div className="p-3">
                <MemoryActionsPanel actions={memoryActions} onDismiss={dismissMemoryAction} />
              </div>
            </div>
          )}

          <FleetOptimizationCard />

          {!isEmpty && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Suspense fallback={null}>
                <UpcomingRoutinesCard />
              </Suspense>
              <Suspense fallback={null}>
                <VaultRecentChangesCard />
              </Suspense>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// InstrumentsBay — secondary row with Top Performers, Traffic chart, Health
// Digest, and analytics inserts. Mirrors the three-column content the
// baseline renders in its main grid, styled as a cockpit sub-panel.
// ---------------------------------------------------------------------------

export function InstrumentsBay({
  chartData, chartTotals, executionDashboardFetchedAt, executionDashboardError,
}: {
  chartData: { date: string; traffic: number; errors: number }[];
  chartTotals: { totalTraffic: number; totalErrors: number };
  executionDashboardFetchedAt: number | undefined;
  executionDashboardError: boolean;
}) {
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <PaneHeader label="Instruments" subtitle="fleet telemetry" />
      <div className="p-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left — leaderboard snapshot */}
        <div>
          <TopPerformersWidget />
        </div>

        {/* Center — traffic chart + analytics */}
        <div className="space-y-4">
          <div className="relative">
            <StalenessIndicator
              fetchedAt={executionDashboardFetchedAt}
              hasError={executionDashboardError}
              label="Traffic"
            />
            <TrafficErrorsChart
              chartData={chartData}
              totalTraffic={chartTotals.totalTraffic}
              totalErrors={chartTotals.totalErrors}
            />
          </div>
          <Suspense fallback={null}>
            <AnalyticsInserts position="center" />
          </Suspense>
        </div>

        {/* Right — health digest + analytics */}
        <div className="space-y-4">
          <HealthDigestPanel />
          <Suspense fallback={null}>
            <AnalyticsInserts position="right" />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TriagePane — ranked queue of items needing the operator's attention
// ---------------------------------------------------------------------------

const TRIAGE_META: Record<TriageKind, { Icon: typeof ClipboardCheck; color: string; bg: string; border: string; tag: string }> = {
  review: { Icon: ClipboardCheck, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', tag: 'REV' },
  alert:  { Icon: AlertTriangle,  color: 'text-red-400',   bg: 'bg-red-500/10',   border: 'border-red-500/20',   tag: 'ALT' },
};

export function TriagePane({ items }: { items: TriageItem[] }) {
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <PaneHeader label="Triage" subtitle={`${items.length} open`} />
      <div className="flex-1 divide-y divide-primary/5 max-h-[28rem] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center typo-body text-foreground/60">
            All clear.
          </div>
        ) : (
          items.map((item) => {
            const meta = TRIAGE_META[item.kind];
            const Icon = meta.Icon;
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/[0.04] transition-colors group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
              >
                <span className={`typo-caption font-mono px-1.5 py-0.5 rounded-sm border ${meta.bg} ${meta.border} ${meta.color} flex-shrink-0`}>
                  {meta.tag}
                </span>
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${meta.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="typo-body text-foreground truncate">{item.title}</div>
                  {item.detail && (
                    <div className="typo-caption text-foreground/60 truncate">{item.detail}</div>
                  )}
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-foreground/40 group-hover:text-foreground/70 transition-colors flex-shrink-0" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VitalsConsole — central pane: success ring + four big readouts + sparkline
// ---------------------------------------------------------------------------

export function VitalsConsole({
  successRate, activeAgents, activeAlertCount, totalExecutions, pendingReviews, points,
}: {
  successRate: number;
  activeAgents: number;
  activeAlertCount: number;
  totalExecutions: number;
  pendingReviews: number;
  points: { date: string; total_executions: number; failed: number }[];
}) {
  const formatCount = useCallback((v: number) => Math.round(v).toLocaleString(), []);

  // Build a tiny static sparkline of traffic vs errors for context
  const sparkline = useMemo(() => {
    if (!points.length) return null;
    const max = Math.max(...points.map((p) => p.total_executions), 1);
    const w = 200, h = 40;
    const step = w / Math.max(points.length - 1, 1);
    const toY = (v: number) => h - (v / max) * h;
    const traffic = points.map((p, i) => `${i * step},${toY(p.total_executions).toFixed(1)}`).join(' ');
    const errors = points.map((p, i) => `${i * step},${toY(p.failed).toFixed(1)}`).join(' ');
    return { traffic, errors, w, h };
  }, [points]);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <PaneHeader label="Vitals" subtitle="fleet health" />
      <div className="flex-1 flex flex-col items-center gap-5 px-4 py-6">
        <SuccessRing rate={successRate} />
        <div className="w-full grid grid-cols-2 gap-3">
          <StatTile icon={<Activity className="w-3.5 h-3.5" />} label="Runs" value={totalExecutions} format={formatCount} color="text-emerald-400" />
          <StatTile icon={<Cpu className="w-3.5 h-3.5" />} label="Agents" value={activeAgents} color="text-violet-400" />
          <StatTile icon={<Bell className="w-3.5 h-3.5" />} label="Alerts" value={activeAlertCount} color={activeAlertCount > 0 ? 'text-red-400' : 'text-foreground/60'} />
          <StatTile icon={<ClipboardCheck className="w-3.5 h-3.5" />} label="Reviews" value={pendingReviews} color={pendingReviews > 0 ? 'text-amber-400' : 'text-foreground/60'} />
        </div>
        {sparkline && (
          <div className="w-full pt-3 border-t border-primary/10">
            <div className="flex items-center justify-between typo-caption uppercase tracking-widest text-foreground/50 mb-1.5 font-mono">
              <span>traffic · errors</span>
              <span>{points.length}d</span>
            </div>
            <svg viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} className="w-full h-10" preserveAspectRatio="none" aria-hidden="true">
              <polyline fill="none" stroke="#06b6d4" strokeWidth="1.5" points={sparkline.traffic} />
              <polyline fill="none" stroke="#f43f5e" strokeWidth="1.5" points={sparkline.errors} />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

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
          <span className="text-foreground/60 text-2xl">%</span>
        </div>
        <div className="typo-caption uppercase tracking-[0.25em] text-foreground/50 mt-1 font-mono">
          success
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon, label, value, format, color,
}: { icon: React.ReactNode; label: string; value: number; format?: (v: number) => string; color: string }) {
  return (
    <div className="rounded-card border border-primary/10 bg-primary/[0.03] px-3 py-2.5 flex items-center gap-2.5">
      <span className={color}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="typo-caption uppercase tracking-widest text-foreground/50 font-mono">{label}</div>
        <div className={`font-mono text-xl tabular-nums ${color}`}>
          <AnimatedCounter value={value} formatFn={format} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityStreamLog — mono-styled execution log
// ---------------------------------------------------------------------------

export function ActivityStreamLog({
  executions, onViewAll,
}: {
  executions: { id: string; status: string; persona_name?: string; created_at: string }[];
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <PaneHeader label="Stream" subtitle={`${executions.length} events`}>
        <button
          onClick={onViewAll}
          className="typo-caption text-primary/80 hover:text-primary transition-colors flex items-center gap-1 font-mono uppercase tracking-widest"
        >
          {t.overview.widgets.view_all} <ArrowRight className="w-3 h-3" />
        </button>
      </PaneHeader>
      <div className="flex-1 divide-y divide-primary/5 max-h-[28rem] overflow-y-auto font-mono text-xs">
        {executions.length === 0 ? (
          <div className="px-4 py-8 text-center typo-body text-foreground/60">No events.</div>
        ) : (
          executions.map((exec) => {
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
                <span className="text-foreground/50 tabular-nums flex-shrink-0">{time}</span>
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
}

// ---------------------------------------------------------------------------
// StatusTicker — bottom strip with pipeline metadata
// ---------------------------------------------------------------------------

export function StatusTicker({
  pipelineSources, pipelineErrors, totalExecutions, lastSyncedLabel,
}: {
  pipelineSources: number;
  pipelineErrors: number;
  totalExecutions: number;
  lastSyncedLabel: string;
}) {
  const fieldCls = 'flex items-center gap-1.5 typo-caption font-mono uppercase tracking-widest';
  return (
    <div className="rounded-card border border-primary/10 bg-primary/[0.03] px-4 py-2 flex items-center gap-5 overflow-x-auto">
      <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground/50 flex-shrink-0">status</span>
      <div className={`${fieldCls} text-foreground/70`}>
        <span className="text-foreground/50">sources</span>
        <span className="text-foreground tabular-nums">{pipelineSources}</span>
      </div>
      <div className={`${fieldCls}`}>
        <span className="text-foreground/50">errors</span>
        <span className={`tabular-nums ${pipelineErrors > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{pipelineErrors}</span>
      </div>
      <div className={`${fieldCls} text-foreground/70`}>
        <span className="text-foreground/50">runs</span>
        <span className="text-foreground tabular-nums">{totalExecutions.toLocaleString()}</span>
      </div>
      <div className={`${fieldCls} text-foreground/70 ml-auto flex-shrink-0`}>
        <span className="text-foreground/50">synced</span>
        <span className="text-foreground tabular-nums">{lastSyncedLabel}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pane header
// ---------------------------------------------------------------------------

function PaneHeader({
  label, subtitle, children,
}: { label: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
      <div className="flex items-baseline gap-2">
        <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground/70">{label}</span>
        {subtitle && (
          <span className="typo-caption text-foreground/40">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}
