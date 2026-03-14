import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Brain, ChevronDown, ChevronUp, Search, List, GitCommitVertical, GitCompareArrows, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import TeamMemoryRow from './TeamMemoryRow';
import AddTeamMemoryForm from './AddTeamMemoryForm';
import MemoryTimeline from './MemoryTimeline';
import RunDiffView from './RunDiffView';

const CATEGORY_FILTERS = ['all', 'observation', 'decision', 'context', 'learning'] as const;

import type { TeamMemoryViewMode as ViewMode } from '@/lib/constants/uiModes';

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
  teamId,
  memories,
  total,
  stats,
  onClose,
  onDelete,
  onImportanceChange,
  onCreate,
  onFilter,
  onLoadMore,
  onFilterByRun,
  onEdit,
}: TeamMemoryPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeRunFilter, setActiveRunFilter] = useState<string | null>(null);

  const hasMore = memories.length < total;

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
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
    // When selecting a run from timeline, switch to list view filtered to that run
    if (runId) setViewMode('list');
    onFilterByRun?.(runId);
  }, [onFilterByRun]);

  // Client-side run filter for list view
  const displayMemories = useMemo(() => {
    if (!activeRunFilter) return memories;
    return memories.filter((m) => m.run_id === activeRunFilter);
  }, [memories, activeRunFilter]);

  // Determine if timeline view has run data to show
  const hasRunData = stats?.run_counts && stats.run_counts.length > 0;

  return (
    <motion.div
      initial={{ x: -280, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -280, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute top-14 left-3 z-30 w-72 bg-secondary/95 backdrop-blur-xl border border-primary/15 rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-foreground/90">Team Memory</span>
          <span className="text-sm px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-medium">
            {total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          {hasRunData && (
            <div className="flex items-center rounded-lg border border-primary/10 overflow-hidden mr-1">
              <Button
                onClick={() => { setViewMode('list'); handleFilterByRun(null); }}
                variant="ghost"
                size="xs"
                className={`p-1 rounded-none ${
                  viewMode === 'list'
                    ? 'bg-violet-500/20 text-violet-400'
                    : 'text-muted-foreground/40 hover:text-muted-foreground/60'
                }`}
                title="List view"
                icon={<List className="w-3 h-3" />}
              />
              <Button
                onClick={() => setViewMode('timeline')}
                variant="ghost"
                size="xs"
                className={`p-1 rounded-none ${
                  viewMode === 'timeline'
                    ? 'bg-violet-500/20 text-violet-400'
                    : 'text-muted-foreground/40 hover:text-muted-foreground/60'
                }`}
                title="Timeline view"
                icon={<GitCommitVertical className="w-3 h-3" />}
              />
              {stats?.run_counts && stats.run_counts.length >= 2 && (
                <Button
                  onClick={() => setViewMode('diff')}
                  variant="ghost"
                  size="xs"
                  className={`p-1 rounded-none ${
                    viewMode === 'diff'
                      ? 'bg-violet-500/20 text-violet-400'
                      : 'text-muted-foreground/40 hover:text-muted-foreground/60'
                  }`}
                  title="Compare runs"
                  icon={<GitCompareArrows className="w-3 h-3" />}
                />
              )}
            </div>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="p-1 rounded-lg text-muted-foreground/60"
            onClick={onClose}
            icon={<ChevronDown className="w-4 h-4" />}
          />
        </div>
      </div>

      {/* Category chips (list view only) */}
      {viewMode === 'list' && (
        <div className="flex gap-1 px-3 py-2 overflow-x-auto scrollbar-hide">
          {CATEGORY_FILTERS.map((cat) => (
            <Button
              key={cat}
              variant="ghost"
              size="xs"
              className={`px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${
                activeCategory === cat
                  ? 'bg-violet-500/20 text-violet-400 font-medium'
                  : 'bg-primary/5 text-muted-foreground/60 hover:bg-primary/10'
              }`}
              onClick={() => handleCategoryChange(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      )}

      {/* Search (list view only) */}
      {viewMode === 'list' && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
            <input
              className="w-full text-sm bg-primary/5 border border-primary/10 rounded-xl pl-6 pr-2 py-1.5 text-foreground/80 placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/20"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          {activeRunFilter && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <GitCommitVertical className="w-3 h-3 text-violet-400 flex-shrink-0" />
              <span className="text-sm text-violet-400 font-mono truncate flex-1">
                Run {activeRunFilter.length > 8 ? activeRunFilter.slice(0, 8) : activeRunFilter}
              </span>
              <Button
                onClick={() => handleFilterByRun(null)}
                variant="ghost"
                size="xs"
                className="p-0.5 rounded text-violet-400/60 hover:text-violet-400 flex-shrink-0"
                title="Clear run filter"
                icon={<X className="w-3 h-3" />}
              />
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="max-h-80 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10">
        {viewMode === 'diff' ? (
          <RunDiffView stats={stats} onClose={() => setViewMode('list')} />
        ) : viewMode === 'timeline' ? (
          <MemoryTimeline
            memories={memories}
            stats={stats}
            onFilterRun={handleFilterByRun}
            activeRunFilter={activeRunFilter}
          />
        ) : displayMemories.length === 0 ? (
          <div className="text-center py-6">
            <Brain className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">
              {activeRunFilter ? 'No memories for this run' : 'No memories yet'}
            </p>
            <p className="text-sm text-muted-foreground/60 mt-0.5">
              {activeRunFilter ? 'Try clearing the run filter' : 'Run a pipeline or add one manually'}
            </p>
          </div>
        ) : (
          <>
            {displayMemories.map((memory) => (
              <TeamMemoryRow
                key={memory.id}
                memory={memory}
                onDelete={onDelete}
                onImportanceChange={onImportanceChange}
                onEdit={onEdit}
              />
            ))}
            {hasMore && !activeRunFilter && (
              <Button
                onClick={handleLoadMore}
                disabled={loadingMore}
                loading={loadingMore}
                variant="ghost"
                size="sm"
                block
                className="py-1.5 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded-lg"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </Button>
            )}
            {!activeRunFilter && total > memories.length && (
              <div className="text-center text-sm text-muted-foreground/60 py-1">
                Showing {memories.length} of {total}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Memory Form */}
      <div className="px-2.5 pb-2.5">
        <AddTeamMemoryForm teamId={teamId} onSubmit={onCreate} />
      </div>

      {/* Stats footer */}
      {stats && stats.total > 0 && (
        <div className="border-t border-primary/10 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            block
            className="flex items-center justify-between w-full text-muted-foreground/50 hover:text-muted-foreground/70"
            onClick={() => setStatsExpanded(!statsExpanded)}
            iconRight={statsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          >
            <span>
              Avg importance: {stats.avg_importance.toFixed(1)} | {stats.category_counts.length} categories
            </span>
          </Button>
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
