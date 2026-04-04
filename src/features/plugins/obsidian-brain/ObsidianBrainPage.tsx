import { lazy, Suspense } from 'react';
import { Brain, Settings, RefreshCw, FolderOpen } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { ObsidianBrainTab } from '@/lib/types/types';

const SetupPanel = lazy(() => import('./sub_setup/SetupPanel'));
const SyncPanel = lazy(() => import('./sub_sync/SyncPanel'));
const BrowsePanel = lazy(() => import('./sub_browse/BrowsePanel'));

const tabs: { id: ObsidianBrainTab; label: string; icon: typeof Brain }[] = [
  { id: 'setup', label: 'Setup', icon: Settings },
  { id: 'sync', label: 'Sync', icon: RefreshCw },
  { id: 'browse', label: 'Browse Vault', icon: FolderOpen },
];

export default function ObsidianBrainPage() {
  const obsidianBrainTab = useSystemStore((s) => s.obsidianBrainTab);
  const setObsidianBrainTab = useSystemStore((s) => s.setObsidianBrainTab);
  const pendingConflicts = useSystemStore((s) => s.obsidianPendingConflicts);

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-4 pb-2">
        <Brain className="w-5 h-5 text-violet-400 mr-2" />
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setObsidianBrainTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg typo-heading transition-colors ${
                obsidianBrainTab === t.id
                  ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                  : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              {t.id === 'sync' && pendingConflicts > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  {pendingConflicts}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div key={obsidianBrainTab} className="animate-fade-slide-in flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <Suspense fallback={null}>
          {obsidianBrainTab === 'setup' && <SetupPanel />}
          {obsidianBrainTab === 'sync' && <SyncPanel />}
          {obsidianBrainTab === 'browse' && <BrowsePanel />}
        </Suspense>
      </div>
    </div>
  );
}
