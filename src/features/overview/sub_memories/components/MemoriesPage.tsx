import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Brain, Plus, Search, X, Sparkles, Shield } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { MemoryRow } from './MemoryCard';
import { InlineAddMemoryForm } from './CreateMemoryForm';
import { MemoryConflictReview } from './MemoryConflictReview';
import ReviewResultsModal from './ReviewResultsModal';
import MemoryDetailModal from './MemoryDetailModal';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import type { MemoryReviewResult, MemoryStats } from '@/api/overview/memories';
import type { PersonaMemory } from '@/lib/types/types';

const CATEGORY_HEX_COLORS: Record<string, string> = {
  fact: '#3b82f6',
  preference: '#f59e0b',
  instruction: '#8b5cf6',
  context: '#10b981',
  learned: '#06b6d4',
  constraint: '#ef4444',
};

function MemoryStatsSummaryBar({ stats }: { stats: MemoryStats }) {
  const avgPct = ((stats.avg_importance / 5) * 100);
  const total = stats.total || 1;

  return (
    <div className="flex items-center gap-4 px-4 md:px-6 py-1.5 border-b border-primary/10 bg-secondary/5 flex-shrink-0 h-10">
      <span className="text-xs font-mono text-foreground/60 flex-shrink-0 tabular-nums">
        {stats.total} total
      </span>

      {/* Avg importance ring */}
      <div className="flex items-center gap-1.5 flex-shrink-0" title={`Avg importance: ${stats.avg_importance.toFixed(1)}/5`}>
        <svg width="18" height="18" viewBox="0 0 18 18" className="flex-shrink-0">
          <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/15" />
          <circle
            cx="9" cy="9" r="7" fill="none"
            stroke={avgPct <= 40 ? '#34d399' : avgPct <= 60 ? '#fbbf24' : '#fb7185'}
            strokeWidth="2"
            strokeDasharray={`${(avgPct / 100) * 44} 44`}
            strokeLinecap="round"
            transform="rotate(-90 9 9)"
            style={{ transition: 'stroke-dasharray 300ms' }}
          />
        </svg>
        <span className="text-xs text-foreground/50 tabular-nums">{stats.avg_importance.toFixed(1)}</span>
      </div>

      {/* Category segmented bar */}
      {stats.category_counts.length > 0 && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="flex h-2 rounded-full overflow-hidden flex-1 bg-muted-foreground/10">
            {stats.category_counts.map(([cat, count]) => (
              <div
                key={cat}
                title={`${MEMORY_CATEGORY_COLORS[cat]?.label ?? cat}: ${count}`}
                className="h-full"
                style={{
                  width: `${(count / total) * 100}%`,
                  backgroundColor: CATEGORY_HEX_COLORS[cat] ?? '#6b7280',
                  transition: 'width 300ms',
                  minWidth: count > 0 ? '2px' : 0,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type SortColumn = 'importance' | 'created_at';
type SortDirection = 'asc' | 'desc';
interface SortState { column: SortColumn; direction: SortDirection }

type ViewTab = 'memories' | 'conflicts';

const GRID_COLUMNS = '180px minmax(0,2fr) 100px 80px 100px 40px';

export default function MemoriesPage() {
  const personas = useAgentStore((s) => s.personas);
  const {
    memories, memoriesTotal, memoryStats, fetchMemories, deleteMemory, reviewMemories,
  } = useOverviewStore(useShallow((s) => ({
    memories: s.memories,
    memoriesTotal: s.memoriesTotal,
    memoryStats: s.memoryStats,
    fetchMemories: s.fetchMemories,
    deleteMemory: s.deleteMemory,
    reviewMemories: s.reviewMemories,
  })));

  const [search, setSearch] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const latestFilterRequestRef = useRef(0);
  const [sort] = useState<SortState>({ column: 'created_at', direction: 'desc' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [viewTab, setViewTab] = useState<ViewTab>('memories');

  const [selectedMemory, setSelectedMemory] = useState<PersonaMemory | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<MemoryReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    const requestId = ++latestFilterRequestRef.current;
    const timer = setTimeout(() => {
      if (requestId !== latestFilterRequestRef.current) return;
      fetchMemories({
        persona_id: selectedPersonaId || undefined,
        category: selectedCategory || undefined,
        search: search || undefined,
        sort_column: sort.column,
        sort_direction: sort.direction,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchMemories, selectedPersonaId, selectedCategory, search, sort]);

  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    return map;
  }, [personas]);

  const hasFilters = !!selectedPersonaId || !!selectedCategory || !!search;
  const clearFilters = useCallback(() => { setSearch(''); setSelectedPersonaId(null); setSelectedCategory(null); }, []);

  const { parentRef: memoryListRef, virtualizer } = useVirtualList(memories, 48);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const handleListKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (memories.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, memories.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < memories.length) {
      e.preventDefault();
      setSelectedMemory(memories[focusedIndex]!);
    } else if (e.key === 'Delete' && focusedIndex >= 0 && focusedIndex < memories.length) {
      e.preventDefault();
      deleteMemory(memories[focusedIndex]!.id);
    }
  }, [memories, focusedIndex, deleteMemory]);

  const handleReview = useCallback(async () => {
    setIsReviewing(true); setReviewResult(null); setReviewError(null);
    try {
      const result = await reviewMemories(selectedPersonaId || undefined);
      setReviewResult(result);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally { setIsReviewing(false); }
  }, [reviewMemories, selectedPersonaId]);

  const closeReviewModal = useCallback(() => { setReviewResult(null); setReviewError(null); }, []);

  const personaFilterOptions = useMemo(() => [
    { value: '', label: 'All agents' },
    ...personas.map((p) => ({ value: p.id, label: p.name })),
  ], [personas]);

  const categoryFilterOptions = useMemo(() => [
    { value: '', label: 'All categories' },
    ...ALL_MEMORY_CATEGORIES.map((cat) => ({
      value: cat,
      label: MEMORY_CATEGORY_COLORS[cat]?.label ?? cat,
    })),
  ], []);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Agent Memories"
        subtitle={`${memoriesTotal} memor${memoriesTotal !== 1 ? 'ies' : 'y'} stored by agents`}
        actions={
          <div className="flex items-center gap-2">
            {/* Tab toggles */}
            <button
              onClick={() => setViewTab('memories')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors ${
                viewTab === 'memories'
                  ? 'bg-primary/10 text-foreground border border-primary/20'
                  : 'text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15'
              }`}
            >
              <Brain className="w-4 h-4" />
              <span className="text-sm font-medium">Memories</span>
            </button>
            <button
              onClick={() => setViewTab('conflicts')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors ${
                viewTab === 'conflicts'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/25'
                  : 'text-muted-foreground/80 hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span className="text-sm font-medium">Conflicts</span>
            </button>

            <div className="w-px h-6 bg-primary/10" />

            <button onClick={handleReview} disabled={isReviewing || memoriesTotal === 0} title={isReviewing ? 'Review in progress...' : memoriesTotal === 0 ? 'No memories to review' : undefined} className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-xl border transition-all bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">
              {isReviewing ? <LoadingSpinner size="sm" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isReviewing ? 'Reviewing...' : 'Review'}
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-xl border transition-all ${showAddForm ? 'bg-violet-500/30 text-violet-200 border-violet-500/40' : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'}`}
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
              Add
            </button>
          </div>
        }
      />

      {showAddForm && <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />}

      {viewTab === 'conflicts' ? (
        <ContentBody flex>
          <div className="flex-1 overflow-y-auto p-4">
            <MemoryConflictReview />
          </div>
        </ContentBody>
      ) : (
        <ContentBody flex>
          {/* Search + count bar */}
          <div className="flex items-center gap-3 px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
            <span className="text-sm font-mono text-foreground/60 flex-shrink-0">
              Showing {memories.length} of {memoriesTotal}
            </span>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search memories..."
                className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground/40 hover:text-foreground/70">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-secondary/40 text-foreground/70 border border-primary/10 hover:bg-secondary/60 transition-colors">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {memoryStats && memoryStats.total > 0 && <MemoryStatsSummaryBar stats={memoryStats} />}

          {memories.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-foreground/60">
              <div className="w-16 h-16 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
                <Brain className="w-8 h-8 text-violet-400/40" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground/80">No memories yet</p>
                <p className="text-sm text-foreground/60 mt-1 max-w-xs">
                  {hasFilters ? 'No memories match your filters. Try adjusting your search.' : 'When agents run, they can store valuable notes and learnings here.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Column headers with inline filters */}
              <div className="hidden md:grid gap-0 border-b border-primary/10 bg-background sticky top-0 z-10" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div className="px-2 py-1.5 flex items-center">
                  <ThemedSelect
                    filterable
                    options={personaFilterOptions}
                    value={selectedPersonaId ?? ''}
                    onValueChange={(v) => setSelectedPersonaId(v || null)}
                    placeholder="Agent"
                    wrapperClassName="w-full"
                    className="!px-2 !py-0 !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 hover:!text-foreground typo-label"
                  />
                </div>
                <div className="flex items-center px-4 py-1.5 typo-label text-foreground/80">Title</div>
                <div className="px-2 py-1.5 flex items-center">
                  <ThemedSelect
                    filterable
                    options={categoryFilterOptions}
                    value={selectedCategory ?? ''}
                    onValueChange={(v) => setSelectedCategory(v || null)}
                    placeholder="Category"
                    wrapperClassName="w-full"
                    className="!px-2 !py-0 !rounded-lg !border-transparent !bg-transparent hover:!bg-secondary/30 hover:!text-foreground typo-label"
                  />
                </div>
                <div className="flex items-center px-4 py-1.5 typo-label text-foreground/80">Priority</div>
                <div className="flex items-center justify-end px-4 py-1.5 typo-label text-foreground/80">Created</div>
                <div className="px-2 py-1.5" />
              </div>

              <div ref={memoryListRef} className="flex-1 overflow-y-auto focus:outline-none" tabIndex={0} role="grid" aria-label="Memory list" onKeyDown={handleListKeyDown}>
                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const memory = memories[virtualRow.index]!;
                    const persona = personaMap.get(memory.persona_id);
                    const isFocused = virtualRow.index === focusedIndex;
                    return (
                      <div key={memory.id} data-index={virtualRow.index} role="row" aria-selected={isFocused} style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%' }} className={isFocused ? 'ring-1 ring-primary/40 ring-inset z-[1]' : ''}>
                        <MemoryRow memory={memory} personaName={persona?.name || 'Unknown'} personaColor={persona?.color || '#6B7280'} onDelete={() => deleteMemory(memory.id)} onSelect={() => setSelectedMemory(memory)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </ContentBody>
      )}

      <ReviewResultsModal reviewResult={reviewResult} reviewError={reviewError} onClose={closeReviewModal} />

      {selectedMemory && (() => {
          const persona = personaMap.get(selectedMemory.persona_id);
          return (
            <MemoryDetailModal
              memory={selectedMemory}
              personaName={persona?.name || 'Unknown'}
              personaColor={persona?.color || '#6B7280'}
              onClose={() => setSelectedMemory(null)}
              onDelete={() => deleteMemory(selectedMemory.id)}
            />
          );
        })()}
    </ContentBox>
  );
}
