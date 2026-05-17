import { lazy, Suspense } from 'react';
import { Brain } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

const SetupPanel = lazy(() => import('./sub_setup/SetupPanel'));
const SyncPanel = lazy(() => import('./sub_sync/SyncPanel'));
const BrowsePanel = lazy(() => import('./sub_browse/BrowsePanel'));
const GraphPanel = lazy(() => import('./sub_graph/GraphPanel'));
const CloudSyncPanel = lazy(() => import('./sub_cloud/CloudSyncPanel'));

export default function ObsidianBrainPage() {
  const { t } = useTranslation();
  const obsidianBrainTab = useSystemStore((s) => s.obsidianBrainTab);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.obsidian_brain.title}
        subtitle={t.plugins.obsidian_brain.subtitle}
      />

      <ContentBody centered>
        <div key={obsidianBrainTab} className="animate-fade-slide-in">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><LoadingSpinner size="lg" label="Loading..." /></div>}>
            {obsidianBrainTab === 'setup' && <SetupPanel />}
            {obsidianBrainTab === 'sync' && <SyncPanel />}
            {obsidianBrainTab === 'browse' && <BrowsePanel />}
            {obsidianBrainTab === 'graph' && <GraphPanel />}
            {obsidianBrainTab === 'cloud' && <CloudSyncPanel />}
          </Suspense>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
