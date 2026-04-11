import { Brain, ChevronDown, List, GitCommitVertical, GitCompareArrows } from 'lucide-react';
import type { TeamMemoryViewMode as ViewMode } from '@/lib/constants/uiModes';
import { useTranslation } from '@/i18n/useTranslation';

interface MemoryPanelHeaderProps {
  total: number;
  viewMode: ViewMode;
  hasRunData: boolean;
  hasDiffData: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onClearRunFilter: () => void;
  onClose: () => void;
}

export default function MemoryPanelHeader({
  total,
  viewMode,
  hasRunData,
  hasDiffData,
  onViewModeChange,
  onClearRunFilter,
  onClose,
}: MemoryPanelHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-primary/10">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-foreground/90">{t.pipeline.team_memory}</span>
        <span className="text-sm px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-medium">
          {total}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {/* View mode toggle */}
        {hasRunData && (
          <div className="flex items-center rounded-lg border border-primary/10 overflow-hidden mr-1">
            <button
              onClick={() => { onViewModeChange('list'); onClearRunFilter(); }}
              className={`p-1 transition-colors ${
                viewMode === 'list'
                  ? 'bg-violet-500/20 text-violet-400'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/60'
              }`}
              title={t.pipeline.list_view}
            >
              <List className="w-3 h-3" />
            </button>
            <button
              onClick={() => onViewModeChange('timeline')}
              className={`p-1 transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-violet-500/20 text-violet-400'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/60'
              }`}
              title={t.pipeline.timeline_view}
            >
              <GitCommitVertical className="w-3 h-3" />
            </button>
            {hasDiffData && (
              <button
                onClick={() => onViewModeChange('diff')}
                className={`p-1 transition-colors ${
                  viewMode === 'diff'
                    ? 'bg-violet-500/20 text-violet-400'
                    : 'text-muted-foreground/40 hover:text-muted-foreground/60'
                }`}
                title={t.pipeline.compare_runs}
              >
                <GitCompareArrows className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        <button
          className="p-1 rounded-lg hover:bg-primary/10 text-muted-foreground/60"
          onClick={onClose}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
