import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import MemoryPanelHeader from './MemoryPanelHeader';
import MemoryPanelList from './MemoryPanelList';
import AddTeamMemoryForm from './AddTeamMemoryForm';
import MemoryTimeline from './MemoryTimeline';
import RunDiffView from './RunDiffView';

type ViewMode = 'list' | 'timeline' | 'diff';

interface TeamMemoryPanelProps {
  teamId: string;
  memories: TeamMemory[];
  total: number;
  stats: TeamMemoryStats | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
  onCreate: (input: CreateTeamMemoryInput) => void;
  onFilter: (category?: string, search?: string) => void;
  onLoadMore: () => Promise<void>;
  onFilterByRun?: (runId: string | null) => void;
  onEdit?: (id: string, title: string, content: string, category: string, importance: number) => void;
}

export default function TeamMemoryPanel({
  teamId, memories, total, stats, onClose, onDelete, onImportanceChange,
  onCreate, onFilter, onLoadMore, onFilterByRun, onEdit,
}: TeamMemoryPanelProps) {
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

  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    onFilter(activeCategory === 'all' ? undefined : activeCategory, q || undefined);
  };

  const handleFilterByRun = useCallback((runId: string | null) => {
    setActiveRunFilter(runId);
    if (runId) setViewMode('list');
    onFilterByRun?.(runId);
  }, [onFilterByRun]);

  const displayMemories = useMemo(() => {
    if (!activeRunFilter) return memories;
    return memories.filter((m) => m.run_id === activeRunFilter);
  }, [memories, activeRunFilter]);

  const hasRunData = stats?.run_counts && stats.run_counts.length > 0;

  return (
    <motion.div
      initial={{ x: -280, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -280, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute top-14 left-3 z-30 w-72 bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-xl shadow-2xl overflow-hidden"
    >
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
        <div className="max-h-80 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10">
          <RunDiffView stats={stats} onClose={() => setViewMode('list')} />
        </div>
      ) : viewMode === 'timeline' ? (
        <div className="max-h-80 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10">
          <MemoryTimeline memories={memories} stats={stats} onFilterRun={handleFilterByRun} activeRunFilter={activeRunFilter} />
        </div>
      ) : (
        <MemoryPanelList
          memories={displayMemories}
          total={total}
          activeCategory={activeCategory}
          searchQuery={searchQuery}
          activeRunFilter={activeRunFilter}
          loadingMore={loadingMore}
          onCategoryChange={handleCategoryChange}
          onSearchChange={handleSearchChange}
          onClearRunFilter={() => handleFilterByRun(null)}
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
            className="flex items-center justify-between w-full text-sm text-muted-foreground/50 hover:text-muted-foreground/70"
            onClick={() => setStatsExpanded(!statsExpanded)}
          >
            <span>Avg importance: {stats.avg_importance.toFixed(1)} | {stats.category_counts.length} categories</span>
            {statsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {statsExpanded && (
            <div className="mt-1.5 space-y-0.5">
              {stats.category_counts.map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/60 capitalize">{cat}</span>
                  <span className="text-muted-foreground/60">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
