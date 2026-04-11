import { lazy, Suspense } from 'react';
import { Brain, Settings, RefreshCw, FolderOpen, Cloud } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import type { ObsidianBrainTab } from '@/lib/types/types';

const SetupPanel = lazy(() => import('./sub_setup/SetupPanel'));
const SyncPanel = lazy(() => import('./sub_sync/SyncPanel'));
const BrowsePanel = lazy(() => import('./sub_browse/BrowsePanel'));
const CloudSyncPanel = lazy(() => import('./sub_cloud/CloudSyncPanel'));

const tabs: { id: ObsidianBrainTab; label: string; icon: typeof Brain }[] = [
  { id: 'setup', label: 'Setup', icon: Settings },
  { id: 'sync', label: 'Sync', icon: RefreshCw },
  { id: 'browse', label: 'Browse Vault', icon: FolderOpen },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
];

export default function ObsidianBrainPage() {
  const obsidianBrainTab = useSystemStore((s) => s.obsidianBrainTab);
  const setObsidianBrainTab = useSystemStore((s) => s.setObsidianBrainTab);
  const pendingConflicts = useSystemStore((s) => s.obsidianPendingConflicts);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Obsidian Brain"
        subtitle="Bidirectional sync between your Obsidian vault and Personas"
        actions={
          <div className="flex items-center gap-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setObsidianBrainTab(t.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg typo-caption font-medium transition-colors focus-ring ${
                    obsidianBrainTab === t.id
                      ? 'bg-violet-500/15 text-violet-400 border border-violet-500/25'
                      : 'text-muted-foreground/60 hover:bg-secondary/40 hover:text-foreground/80 border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                  {t.id === 'sync' && pendingConflicts > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      {pendingConflicts}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        }
      />

      <ContentBody centered>
        <div key={obsidianBrainTab} className="animate-fade-slide-in">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><LoadingSpinner size="lg" label="Loading..." /></div>}>
            {obsidianBrainTab === 'setup' && <SetupPanel />}
            {obsidianBrainTab === 'sync' && <SyncPanel />}
            {obsidianBrainTab === 'browse' && <BrowsePanel />}
            {obsidianBrainTab === 'cloud' && <CloudSyncPanel />}
          </Suspense>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
