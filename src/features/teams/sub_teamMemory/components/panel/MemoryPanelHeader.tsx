import { Brain, ChevronDown, List, GitCommitVertical, GitCompareArrows } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import type { TeamMemoryViewMode as ViewMode } from '@/lib/constants/uiModes';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-hair">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-role-agent" />
        <span className="typo-heading text-ink-2">{t.pipeline.team_memory}</span>
        <span className="typo-data text-ink-3">
          {total}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {/* View mode toggle */}
        {hasRunData && (
          <div className="flex items-center rounded-card border border-hair overflow-hidden mr-1">
            <Tooltip content={t.pipeline.list_view}>
              <Button variant={viewMode === 'list' ? "secondary" : "ghost"} size="icon-sm" onClick={() => { onViewModeChange('list'); onClearRunFilter(); }} aria-pressed={viewMode === 'list'} aria-label={t.pipeline.list_view}>
                <List className="w-3 h-3" />
              </Button>
            </Tooltip>
            <Tooltip content={t.pipeline.timeline_view}>
              <Button variant={viewMode === 'timeline' ? "secondary" : "ghost"} size="icon-sm" onClick={() => onViewModeChange('timeline')} aria-pressed={viewMode === 'timeline'} aria-label={t.pipeline.timeline_view}>
                <GitCommitVertical className="w-3 h-3" />
              </Button>
            </Tooltip>
            {hasDiffData && (
              <Tooltip content={t.pipeline.compare_runs}>
                <Button variant={viewMode === 'diff' ? "secondary" : "ghost"} size="icon-sm" onClick={() => onViewModeChange('diff')} aria-pressed={viewMode === 'diff'} aria-label={t.pipeline.compare_runs}>
                  <GitCompareArrows className="w-3 h-3" />
                </Button>
              </Tooltip>
            )}
          </div>
        )}
        {/* Icon-only, and it had no accessible name at all: a screen reader
            announced it as an unlabelled button. */}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
          <ChevronDown className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
