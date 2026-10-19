import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import MemoryPanelHeader from './MemoryPanelHeader';
import MemoryPanelList from './MemoryPanelList';
import AddTeamMemoryForm from './AddTeamMemoryForm';
import MemoryTimeline from '../timeline/MemoryTimeline';
import RunDiffView from '../diff/RunDiffView';
import type { TeamMemoryViewMode as ViewMode } from '@/lib/constants/uiModes';

interface TeamMemoryPanelProps {
  teamId: string;
  memories: TeamMemory[];
  total: number;
  stats: TeamMemoryStats | null;
  isFetching?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
  onCreate: (input: CreateTeamMemoryInput) => Promise<boolean> | void;
  onFilter: (category?: string, search?: string) => void;
  onLoadMore: () => Promise<void>;
  onFilterByRun?: (runId: string | null) => void;
  /** Resolves `false` when the write failed; the editor then stays open with the draft. */
  onEdit?: (id: string, title: string, content: string, category: string, importance: number) => Promise<boolean> | void;
}

export default function TeamMemoryPanel({
  teamId, memories, total, stats, isFetching = false, loadFailed = false, onRetry, onClose, onDelete, onImportanceChange,
  onCreate, onFilter, onLoadMore, onFilterByRun, onEdit,
}: TeamMemoryPanelProps) {
  const { t, tx } = useTranslation();
  const pt = t.pipeline;
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeRunFilter, setActiveRunFilter] = useState<string | null>(null);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try { await onLoadMore(); } finally { setLoadingMore(false); }
  }, [onLoadMore]);

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    onFilter(cat === 'all' ? undefined : cat, searchQuery || undefined);
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onFilter(activeCategory === 'all' ? undefined : activeCategory, q || undefined);
    }, 300);
  };

  const handleFilterByRun = useCallback((runId: string | null) => {
    setActiveRunFilter(runId);
    if (runId) setViewMode('list');
    onFilterByRun?.(runId);
  }, [onFilterByRun]);

  const handleClearAllFilters = useCallback(() => {
    setActiveCategory('all');
    setSearchQuery('');
    setActiveRunFilter(null);
    onFilterByRun?.(null);
    onFilter(undefined, undefined);
  }, [onFilter, onFilterByRun]);

  const hasRunData = stats?.run_counts && stats.run_counts.length > 0;

  // One layout: the panel fills its host pane. The floating canvas overlay
  // (resize handle, stored width, window drag listeners) went with the DAG
  // canvas; `TeamMemoryPane` is the only host and always passed `pane`.
  return (
    <div className="h-full w-full max-w-xl flex flex-col rounded-modal border border-primary/15 bg-secondary/30 overflow-hidden">
      <MemoryPanelHeader
        total={total}
        viewMode={viewMode}
        hasRunData={!!hasRunData}
        hasDiffData={!!stats?.run_counts && stats.run_counts.length >= 2}
        onViewModeChange={setViewMode}
        onClearRunFilter={() => handleFilterByRun(null)}
        onClose={onClose}
      />

      {viewMode === 'diff' ? (
        <div className={`flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10`}>
          <RunDiffView stats={stats} onClose={() => setViewMode('list')} />
        </div>
      ) : viewMode === 'timeline' ? (
        <div className={`flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10`}>
          <MemoryTimeline memories={memories} stats={stats} onFilterRun={handleFilterByRun} activeRunFilter={activeRunFilter} />
        </div>
      ) : (
        <MemoryPanelList
          memories={memories}
          total={total}
          activeCategory={activeCategory}
          searchQuery={searchQuery}
          activeRunFilter={activeRunFilter}
          loadingMore={loadingMore}
          isFetching={isFetching}
          loadFailed={loadFailed}
          onRetry={onRetry}
          onCategoryChange={handleCategoryChange}
          onSearchChange={handleSearchChange}
          onClearRunFilter={() => handleFilterByRun(null)}
          onClearAll={handleClearAllFilters}
          onLoadMore={handleLoadMore}
          onDelete={onDelete}
          onImportanceChange={onImportanceChange}
          onEdit={onEdit}
        />
      )}

      <div className="px-2.5 pb-2.5">
        <AddTeamMemoryForm teamId={teamId} onSubmit={onCreate} />
      </div>

      {stats && stats.total > 0 && (
        <div className="border-t border-primary/10 px-3 py-2">
          <button
            type="button"
            className="flex items-center justify-between w-full typo-body text-foreground hover:text-muted-foreground/70"
            onClick={() => setStatsExpanded(!statsExpanded)}
          >
            {/* `getTeamMemoryStats(teamId, category, search)` takes no runId --
                these stats, and the per-category counts under them, always
                describe the WHOLE team. With a run filter active the list above
                shows one run, so an unqualified "Avg importance: 4.2 | 8
                categories" read as that run's numbers and silently contradicted
                the list it sat beneath. Say whose numbers they are. */}
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{tx(pt.avg_importance, { value: stats.avg_importance.toFixed(1), count: stats.category_counts.length })}</span>
              {activeRunFilter && <span className="typo-caption text-foreground flex-shrink-0">{pt.stats_team_wide}</span>}
            </span>
            {statsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {statsExpanded && (
            <div className="mt-1.5 space-y-0.5">
              {stats.category_counts.map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between typo-body">
                  <span className="text-foreground capitalize">{cat}</span>
                  <span className="text-foreground">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
