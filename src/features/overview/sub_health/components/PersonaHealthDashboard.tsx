import { useEffect, useCallback, useMemo, useState, lazy, Suspense } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Activity, RefreshCw, Heart, AlertTriangle, Shield, Zap, LayoutGrid, Rows3 } from 'lucide-react';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { PersonaHealthCard } from './PersonaHealthCard';
import { BurnRateProjection } from './BurnRateProjection';
import { CascadeVisualization } from './CascadeVisualization';
import { PredictiveAlerts } from './PredictiveAlerts';
import { HeartbeatIndicator } from './HeartbeatIndicator';
import { CircuitBreakerIndicator } from '@/features/agents/sub_executions/components/CircuitBreakerIndicator';
import type { HealthGrade, DataSourceStatusMap, DataSourceName } from '@/stores/slices/overview/personaHealthSlice';

const StatusPageView = lazy(() => import('./StatusPageView').then(m => ({ default: m.StatusPageView })));

type HealthView = 'heartbeats' | 'status-page' | 'reliability';

const SLADashboard = lazy(() => import('@/features/overview/sub_sla'));
type FilterGrade = 'all' | HealthGrade;

export default function PersonaHealthDashboard() {
  const { t } = useTranslation();
  const {
    healthSignals, cascadeLinks, routingRecommendations,
    healthLoading, healthError, healthLastRefreshedAt,
    dataSourceStatus, refreshHealthDashboard,
  } = useOverviewStore(useShallow((s) => ({
    healthSignals: s.healthSignals,
    cascadeLinks: s.cascadeLinks,
    routingRecommendations: s.routingRecommendations,
    healthLoading: s.healthLoading,
    healthError: s.healthError,
    healthLastRefreshedAt: s.healthLastRefreshedAt,
    dataSourceStatus: s.dataSourceStatus,
    refreshHealthDashboard: s.refreshHealthDashboard,
  })));

  const [gradeFilter, setGradeFilter] = useState<FilterGrade>('all');
  const [healthView, setHealthView] = useState<HealthView>('heartbeats');

  // Initial load — deferred to idle to avoid blocking the main thread
  // during section navigation. The health computation is expensive (~400ms).
  useEffect(() => {
    if (healthSignals.length === 0 && !healthLoading) {
      const run = () => void refreshHealthDashboard();
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(run, { timeout: 2000 });
        return () => cancelIdleCallback(id);
      }
      const t = setTimeout(run, 200);
      return () => clearTimeout(t);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    void refreshHealthDashboard();
  }, [refreshHealthDashboard]);

  // Grade counts
  const gradeCounts = useMemo(() => {
    const counts = { healthy: 0, degraded: 0, critical: 0, unknown: 0 };
    for (const s of healthSignals) counts[s.grade]++;
    return counts;
  }, [healthSignals]);

  // Filtered signals
  const filteredSignals = useMemo(
    () => gradeFilter === 'all' ? healthSignals : healthSignals.filter(s => s.grade === gradeFilter),
    [healthSignals, gradeFilter],
  );

  // Global health score
  const globalScore = useMemo(() => {
    if (healthSignals.length === 0) return 0;
    return Math.round(healthSignals.reduce((sum, s) => sum + s.heartbeatScore, 0) / healthSignals.length);
  }, [healthSignals]);

  const globalGrade = useMemo((): HealthGrade => {
    if (globalScore >= 80) return 'healthy';
    if (globalScore >= 50) return 'degraded';
    if (globalScore > 0) return 'critical';
    return 'unknown';
  }, [globalScore]);

  const lastRefreshLabel = useMemo(() => {
    if (!healthLastRefreshedAt) return null;
    const ago = Math.round((Date.now() - healthLastRefreshedAt) / 1000);
    if (ago < 60) return `${ago}s ago`;
    return `${Math.round(ago / 60)}m ago`;
  }, [healthLastRefreshedAt]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Activity className="w-5 h-5 text-rose-400" />}
        iconColor="red"
        title={t.overview.health.title}
        subtitle={t.overview.health.subtitle}
        actions={
          <>
            {/* View toggle */}
            <div className="flex items-center border border-primary/10 rounded-card overflow-hidden mr-2">
              <button
                onClick={() => setHealthView('heartbeats')}
                className={`flex items-center gap-1.5 px-2.5 py-1 typo-caption transition-colors ${
                  healthView === 'heartbeats'
                    ? 'bg-primary/10 text-foreground/90'
                    : 'text-foreground hover:bg-secondary/40'
                }`}
                title={t.overview.health_dashboard.heartbeats_view}
              >
                <LayoutGrid className="w-3 h-3" /> {t.overview.health_dashboard.heartbeats_btn}
              </button>
              <button
                onClick={() => setHealthView('status-page')}
                className={`flex items-center gap-1.5 px-2.5 py-1 typo-caption transition-colors ${
                  healthView === 'status-page'
                    ? 'bg-primary/10 text-foreground/90'
                    : 'text-foreground hover:bg-secondary/40'
                }`}
                title={t.overview.health_dashboard.status_page_view}
              >
                <Rows3 className="w-3 h-3" /> {t.overview.health.status_page}
              </button>
              <button
                onClick={() => setHealthView('reliability')}
                className={`flex items-center gap-1.5 px-2.5 py-1 typo-caption transition-colors ${
                  healthView === 'reliability'
                    ? 'bg-primary/10 text-foreground/90'
                    : 'text-foreground hover:bg-secondary/40'
                }`}
                title={t.overview.health_dashboard.reliability_view}
              >
                <Shield className="w-3 h-3" /> {t.overview.health_dashboard.reliability_btn}
              </button>
            </div>

            {lastRefreshLabel && (
              <span className="typo-caption text-foreground mr-2">Updated {lastRefreshLabel}</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={healthLoading}
              className="p-1.5 rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
              title={t.overview.health_dashboard.refresh_tooltip}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      <ContentBody>
        {healthView === 'status-page' ? (
          <Suspense fallback={<div className="flex items-center justify-center py-16 text-foreground typo-body">{t.overview.health_dashboard.loading_status_page}</div>}>
            <StatusPageView />
          </Suspense>
        ) : healthView === 'reliability' ? (
          <Suspense fallback={<div className="flex items-center justify-center py-16 text-foreground typo-body">{t.overview.health_dashboard.loading_reliability}</div>}>
            <SLADashboard />
          </Suspense>
        ) : (
        <div className="space-y-6">
          {/* Error Banner */}
          {healthError && (
            <InlineErrorBanner
              severity="error"
              title="Health computation failed"
              message={healthError}
              onRetry={handleRefresh}
            />
          )}

          {/* Staleness Banner */}
          {dataSourceStatus && <StalenessBanner status={dataSourceStatus} onRetry={handleRefresh} />}

          {/* Provider Circuit Breaker Status */}
          <CircuitBreakerIndicator />

          {/* Global Health Summary */}
          <div className="flex items-center gap-6 p-4 rounded-modal border border-primary/10 bg-secondary/10">
            <HeartbeatIndicator score={globalScore} grade={globalGrade} size="lg" />
            <div className="flex-1">
              <h2 className="typo-heading-lg text-foreground/90">
                {t.overview.health_dashboard.system_health} <span className={
                  globalGrade === 'healthy' ? 'text-emerald-400' :
                  globalGrade === 'degraded' ? 'text-amber-400' :
                  globalGrade === 'critical' ? 'text-red-400' : 'text-zinc-400'
                }>{globalGrade.charAt(0).toUpperCase() + globalGrade.slice(1)}</span>
              </h2>
              <p className="typo-body text-foreground mt-0.5">
                {healthSignals.length} persona{healthSignals.length !== 1 ? 's' : ''} monitored
              </p>
            </div>

            {/* Grade Filter Pills */}
            <div className="flex items-center gap-1.5">
              <GradePill grade="all" count={healthSignals.length} active={gradeFilter === 'all'} onClick={() => setGradeFilter('all')} />
              <GradePill grade="healthy" count={gradeCounts.healthy} active={gradeFilter === 'healthy'} onClick={() => setGradeFilter('healthy')} />
              <GradePill grade="degraded" count={gradeCounts.degraded} active={gradeFilter === 'degraded'} onClick={() => setGradeFilter('degraded')} />
              <GradePill grade="critical" count={gradeCounts.critical} active={gradeFilter === 'critical'} onClick={() => setGradeFilter('critical')} />
            </div>
          </div>

          {/* Main Grid Layout */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Heartbeat Grid -- spans 2 cols */}
            <div className="xl:col-span-2 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Heart className="w-4 h-4 text-rose-400" />
                <h3 className="typo-heading text-foreground">{t.overview.health_dashboard.persona_heartbeats}</h3>
                <span className="typo-caption text-foreground">{filteredSignals.length} persona{filteredSignals.length !== 1 ? 's' : ''}</span>
              </div>

              {filteredSignals.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-foreground typo-body">
                  {healthLoading ? t.overview.health_dashboard.computing : t.overview.health_dashboard.no_match}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {filteredSignals.map((signal) => (
                    <PersonaHealthCard key={signal.personaId} signal={signal} />
                  ))}
                </div>
              )}
            </div>

            {/* Right Sidebar */}
            <div className="space-y-4">
              <PredictiveAlerts signals={healthSignals} recommendations={routingRecommendations} />
              <BurnRateProjection signals={healthSignals} />
              <CascadeVisualization links={cascadeLinks} signals={healthSignals} />
            </div>
          </div>
        </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const GRADE_PILL_COLORS: Record<FilterGrade, { active: string; inactive: string; dot: string }> = {
  all: { active: 'bg-primary/15 border-primary/25 text-primary', inactive: 'border-primary/10 text-foreground', dot: 'bg-primary' },
  healthy: { active: 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400', inactive: 'border-primary/10 text-foreground', dot: 'bg-emerald-400' },
  degraded: { active: 'bg-amber-500/15 border-amber-500/25 text-amber-400', inactive: 'border-primary/10 text-foreground', dot: 'bg-amber-400' },
  critical: { active: 'bg-red-500/15 border-red-500/25 text-red-400', inactive: 'border-primary/10 text-foreground', dot: 'bg-red-400' },
  unknown: { active: 'bg-zinc-500/15 border-zinc-500/25 text-zinc-400', inactive: 'border-primary/10 text-foreground', dot: 'bg-zinc-500' },
};

const GRADE_ICONS: Record<FilterGrade, typeof Shield> = {
  all: Activity,
  healthy: Shield,
  degraded: AlertTriangle,
  critical: Zap,
  unknown: Activity,
};

const DATA_SOURCE_LABELS: Record<DataSourceName, string> = {
  monthlySpend: 'Monthly spend (local tz)',
  healingIssues: 'Healing issues',
  byomPolicy: 'BYOM policy',
  providerStats: 'Provider stats',
};

function StalenessBanner({ status, onRetry }: { status: DataSourceStatusMap; onRetry: () => void }) {
  const failedSources = (Object.entries(status) as [DataSourceName, string][])
    .filter(([, state]) => state === 'failed')
    .map(([name]) => DATA_SOURCE_LABELS[name]);

  if (failedSources.length === 0) return null;

  const detail = failedSources.length === 1
    ? `${failedSources[0]} could not be loaded — scores may be inaccurate.`
    : `${failedSources.join(', ')} could not be loaded — scores may be inaccurate.`;

  return (
    <InlineErrorBanner
      severity="warning"
      title="Incomplete health data"
      message={detail}
      onRetry={onRetry}
    />
  );
}

function GradePill({ grade, count, active, onClick }: { grade: FilterGrade; count: number; active: boolean; onClick: () => void }) {
  const colors = GRADE_PILL_COLORS[grade];
  const Icon = GRADE_ICONS[grade];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-card border typo-caption transition-colors ${
        active ? colors.active : `${colors.inactive} hover:bg-secondary/40`
      }`}
    >
      <Icon className="w-3 h-3" />
      <span>{grade === 'all' ? 'All' : grade.charAt(0).toUpperCase() + grade.slice(1)}</span>
      <span className="opacity-60">{count}</span>
    </button>
  );
}
