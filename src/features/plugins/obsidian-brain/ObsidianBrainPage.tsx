import { lazy, Suspense } from 'react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { IconObsidianBrain } from '@/features/plugins/PluginIcons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { ObsidianBrainTab } from '@/lib/types/types';

const SetupPanel = lazy(() => import('./sub_setup/SetupPanel'));
const SyncPanel = lazy(() => import('./sub_sync/SyncPanel'));
const BrowsePanel = lazy(() => import('./sub_browse/BrowsePanel'));
const GraphPanel = lazy(() => import('./sub_graph/GraphPanel'));
const CloudSyncPanel = lazy(() => import('./sub_cloud/CloudSyncPanel'));
const RevitalizePanel = lazy(() => import('./sub_revitalize/RevitalizePanel'));

/**
 * Per-tab spotlight anchors for the Obsidian Brain tour.
 *
 * These literal strings are the tour's `highlightTestId` targets (see
 * OBSIDIAN_BRAIN_STEPS in tourSlice.ts). The anchor lives on this wrapper —
 * not on each panel's root — because the wrapper is the only element present
 * across every panel's loading/empty/connected branch AND outside the lazy
 * Suspense boundary, so the spotlight resolves the instant a tab opens instead
 * of flashing "not on screen yet" while a panel chunk or its vault state loads.
 *
 * They are written as an explicit literal map (not a `obsidian-${tab}-panel`
 * template) so the anchor-drift gate (tourAnchors.test.ts) can find each anchor
 * by static scan — a template literal is invisible to a source-text search and
 * is exactly how this drift went undetected before.
 */
const OBSIDIAN_PANEL_TESTID: Record<ObsidianBrainTab, string> = {
  setup: 'obsidian-setup-panel',
  sync: 'obsidian-sync-panel',
  browse: 'obsidian-browse-panel',
  graph: 'obsidian-graph-panel',
  cloud: 'obsidian-cloud-panel',
  revitalize: 'obsidian-revitalize-panel',
};

export default function ObsidianBrainPage() {
  const { t } = useTranslation();
  const obsidianBrainTab = useSystemStore((s) => s.obsidianBrainTab);

  return (
    <ContentBox>
      <ContentHeader
        icon={<IconObsidianBrain active className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.obsidian_brain.title}
        subtitle={t.plugins.obsidian_brain.subtitle}
      />

      <ContentBody centered>
        {/* data-testid doubles as the Brain tour's spotlight anchor — one
            stable id per tab regardless of connected/empty branch. See
            OBSIDIAN_PANEL_TESTID above for why it's a literal map. */}
        <div key={obsidianBrainTab} className="animate-fade-slide-in" data-testid={OBSIDIAN_PANEL_TESTID[obsidianBrainTab]}>
          <ErrorBoundary name="Obsidian Brain">
            <Suspense fallback={<div className="flex items-center justify-center py-20"><LoadingSpinner size="lg" label={t.plugins.obsidian_brain.loading} /></div>}>
              {obsidianBrainTab === 'setup' && <SetupPanel />}
              {obsidianBrainTab === 'sync' && <SyncPanel />}
              {obsidianBrainTab === 'browse' && <BrowsePanel />}
              {obsidianBrainTab === 'graph' && <GraphPanel />}
              {obsidianBrainTab === 'cloud' && <CloudSyncPanel />}
              {obsidianBrainTab === 'revitalize' && <RevitalizePanel />}
            </Suspense>
          </ErrorBoundary>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
