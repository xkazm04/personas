import { Brain, Search, GitCommitVertical, X } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import TeamMemoryRow from './TeamMemoryRow';

const CATEGORY_FILTERS = ['all', 'observation', 'decision', 'context', 'learning'] as const;

interface MemoryPanelListProps {
  memories: TeamMemory[];
  total: number;
  activeCategory: string;
  searchQuery: string;
  activeRunFilter: string | null;
  loadingMore: boolean;
  onCategoryChange: (cat: string) => void;
  onSearchChange: (q: string) => void;
  onClearRunFilter: () => void;
  onLoadMore: () => void;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
  onEdit?: (id: string, title: string, content: string, category: string, importance: number) => void;
}

export default function MemoryPanelList({
  memories,
  total,
  activeCategory,
  searchQuery,
  activeRunFilter,
  loadingMore,
  onCategoryChange,
  onSearchChange,
  onClearRunFilter,
  onLoadMore,
  onDelete,
  onImportanceChange,
  onEdit,
}: MemoryPanelListProps) {
  const hasMore = memories.length < total;

  return (
    <>
      {/* Category chips */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto scrollbar-hide">
        {CATEGORY_FILTERS.map((cat) => (
          <button
            key={cat}
            className={`text-sm px-2 py-0.5 rounded-full capitalize whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? 'bg-violet-500/20 text-violet-400 font-medium'
                : 'bg-primary/5 text-muted-foreground/60 hover:bg-primary/10'
            }`}
            onClick={() => onCategoryChange(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-3 pb-2 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
          <input
            className="w-full text-sm bg-primary/5 border border-primary/10 rounded-xl pl-6 pr-2 py-1.5 text-foreground/80 placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/20"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {activeRunFilter && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <GitCommitVertical className="w-3 h-3 text-violet-400 flex-shrink-0" />
            <span className="text-sm text-violet-400 font-mono truncate flex-1">
              Run {activeRunFilter.length > 8 ? activeRunFilter.slice(0, 8) : activeRunFilter}
            </span>
            <button
              onClick={onClearRunFilter}
              className="p-0.5 rounded text-violet-400/60 hover:text-violet-400 transition-colors flex-shrink-0"
              title="Clear run filter"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Memory list */}
      <div className="max-h-80 overflow-y-auto px-2 pb-2 space-y-1 scrollbar-thin scrollbar-thumb-primary/10">
        {memories.length === 0 ? (
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
            {memories.map((memory) => (
              <TeamMemoryRow
                key={memory.id}
                memory={memory}
                onDelete={onDelete}
                onImportanceChange={onImportanceChange}
                onEdit={onEdit}
              />
            ))}
            {hasMore && !activeRunFilter && (
              <button
                onClick={onLoadMore}
                disabled={loadingMore}
                className="w-full py-1.5 text-sm text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {loadingMore ? (<><LoadingSpinner size="xs" />Loading...</>) : <>Load more</>}
              </button>
            )}
            {!activeRunFilter && total > memories.length && (
              <div className="text-center text-sm text-muted-foreground/60 py-1">
                Showing {memories.length} of {total}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
