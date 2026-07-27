import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useCertificationData } from './useCertificationData';
import { CertOverview } from './components/CertOverview';
import { RunHistoryView } from './components/RunHistoryView';
import { RunDetailView } from './components/RunDetailView';
import { CertOverviewPlaceholder, RunHistoryPlaceholder, RunDetailPlaceholder } from './components/CertPlaceholders';

type CertTab = 'overview' | 'history';

/**
 * Certification Command Center — dev-only Overview sub-tab that renders the
 * on-disk eval/certification bundles (`docs/test/runs/`) read by the
 * `eval_runs` Tauri commands. Read-only viewer: overview (per-team cert
 * status), history (sortable run list), and per-run detail drill-down.
 */
export default function CertificationCommandCenter() {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const {
    evalRuns,
    certStatus,
    evalRunDetail,
    certLoading,
    certDetailLoading,
    certError,
    certLastRefreshedAt,
    refreshCertification,
    loadEvalRunDetail,
    clearEvalRunDetail,
  } = useCertificationData();

  const [tab, setTab] = useState<CertTab>('overview');
  const [detailMode, setDetailMode] = useState(false);

  // ── Loading choreography (docs/design/overview-loading.md, panel recipe) ──
  // Both trackers live here (CertificationCommandCenter stays mounted across
  // tab switches / detail-mode toggles) so switching back to a tab that
  // already has data never replays its cascade — only the first arrival of a
  // dataset plays the ripple. The detail-section tracker resets per run id:
  // opening a *different* run is genuinely new content and replays; re-render
  // of the same run does not.
  const cardEnter = useRevealTracker();
  const sectionEnter = useRevealTracker(evalRunDetail?.runId);

  const handleSelectRun = useCallback(
    (runId: string) => {
      setDetailMode(true);
      void loadEvalRunDetail(runId);
    },
    [loadEvalRunDetail],
  );

  const handleBack = useCallback(() => {
    setDetailMode(false);
    clearEvalRunDetail();
  }, [clearEvalRunDetail]);

  const handleRefresh = useCallback(() => {
    void refreshCertification();
  }, [refreshCertification]);

  const showEmptyError = !!certError && certStatus.length === 0 && evalRuns.length === 0;

  return (
    <ContentBox>
      <ContentHeader
        icon={<ShieldCheck className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title={c.title}
        subtitle={c.subtitle}
        actions={
          <>
            {certLastRefreshedAt && (
              <span className="typo-caption text-foreground mr-2">
                {c.updated} <RelativeTime timestamp={certLastRefreshedAt} />
              </span>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={certLoading}
              className="p-1.5 rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
              title={c.refresh}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${certLoading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      <ContentBody>
        {showEmptyError ? (
          <InlineErrorBanner severity="error" title={c.error_title} message={certError} onRetry={handleRefresh} />
        ) : detailMode ? (
          certDetailLoading || !evalRunDetail ? (
            <RunDetailPlaceholder />
          ) : (
            <RunDetailView
              detail={evalRunDetail}
              onBack={handleBack}
              hasEntered={sectionEnter.hasEntered}
              markEntered={sectionEnter.markEntered}
            />
          )
        ) : (
          <div className="space-y-4">
            <SegmentedTabs<CertTab>
              tabs={[
                { id: 'overview', label: c.tab_overview },
                { id: 'history', label: c.tab_history },
              ]}
              activeTab={tab}
              onTabChange={setTab}
              ariaLabel={c.title}
            />

            {certLoading && certStatus.length === 0 && evalRuns.length === 0 ? (
              tab === 'overview' ? <CertOverviewPlaceholder /> : <RunHistoryPlaceholder />
            ) : tab === 'overview' ? (
              <CertOverview
                certStatus={certStatus}
                onSelectRun={handleSelectRun}
                hasEntered={cardEnter.hasEntered}
                markEntered={cardEnter.markEntered}
              />
            ) : (
              // RunHistoryView renders through UnifiedTable, which owns row
              // rendering — it has no per-row entrance hook to cascade into
              // (docs/design/overview-loading.md, "Lists & tables" recipe:
              // report the gap rather than hack the shared table primitive).
              // Rows paint instantly on data arrival (law 2); no ripple here.
              <RunHistoryView runs={evalRuns} onSelectRun={handleSelectRun} />
            )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
