import { useEffect, useCallback, useMemo, useState, lazy, Suspense } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Activity, RefreshCw, Shield, LayoutGrid, Rows3 } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import { useShallow } from 'zustand/react/shallow';
import { HeartbeatsView } from './heartbeats';


const StatusPageView = lazy(() => import('./StatusPageView').then(m => ({ default: m.StatusPageView })));

type HealthView = 'heartbeats' | 'status-page' | 'reliability';

const SLADashboard = lazy(() => import('@/features/overview/sub_sla'));

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

  const [healthView, setHealthView] = useState<HealthView>('heartbeats');

  // Gate the initial load on readiness rather than a blind idle timer. The
  // persona fetch is the app's canonical "IPC + session token are ready"
  // signal — firing the bundle before it settled caused the cold-start
  // token-race that surfaced as the "Incomplete health data" banner. Once the
  // agents store has settled we compute on the next frame (no long blind wait).
  const agentsLoading = useAgentStore((s) => s.isLoading);
  useEffect(() => {
    if (healthSignals.length > 0 || healthLoading) return;
    if (agentsLoading) return;

    const id = requestAnimationFrame(() => void refreshHealthDashboard());
    return () => cancelAnimationFrame(id);
  }, [healthSignals.length, healthLoading, agentsLoading, refreshHealthDashboard]);

  const handleRefresh = useCallback(() => {
    void refreshHealthDashboard();
  }, [refreshHealthDashboard]);

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
            <SLADashboard embedded />
          </Suspense>
        ) : (
          <HeartbeatsView
            signals={healthSignals}
            cascadeLinks={cascadeLinks}
            routingRecommendations={routingRecommendations}
            loading={healthLoading}
            error={healthError}
            dataSourceStatus={dataSourceStatus}
            onRefresh={handleRefresh}
          />
        )}
      </ContentBody>
    </ContentBox>
  );
}
