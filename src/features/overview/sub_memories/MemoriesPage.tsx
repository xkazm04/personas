import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Brain, Plus, ChevronDown, ChevronUp, Sparkles, Loader2, CheckCircle2, Trash2, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { MemoryRow } from '@/features/overview/sub_memories/MemoryCard';
import { InlineAddMemoryForm } from '@/features/overview/sub_memories/CreateMemoryForm';
import { MemoryFilterBar } from '@/features/overview/sub_memories/MemoryFilterBar';
import { useVirtualList } from '@/hooks/utility/useVirtualList';
import type { MemoryReviewResult } from '@/api/memories';

type SortColumn = 'importance' | 'created_at';
type SortDirection = 'asc' | 'desc';
interface SortState { column: SortColumn; direction: SortDirection }

// ── Main MemoriesPage ────────────────────────────────────────────
export default function MemoriesPage() {
  const personas = usePersonaStore((s) => s.personas);
  const memories = usePersonaStore((s) => s.memories);
  const memoriesTotal = usePersonaStore((s) => s.memoriesTotal);
  const fetchMemories = usePersonaStore((s) => s.fetchMemories);
  const deleteMemory = usePersonaStore((s) => s.deleteMemory);
  const reviewMemories = usePersonaStore((s) => s.reviewMemories);

  const [search, setSearch] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const latestFilterRequestRef = useRef(0);
  const [sort, setSort] = useState<SortState>({ column: 'created_at', direction: 'desc' });
  const [showAddForm, setShowAddForm] = useState(false);

  // Review state
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<MemoryReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Debounce all filter changes together to avoid mixed-parameter races
  useEffect(() => {
    const requestId = ++latestFilterRequestRef.current;
    const timer = setTimeout(() => {
      if (requestId !== latestFilterRequestRef.current) return;
      fetchMemories({
        persona_id: selectedPersonaId || undefined,
        category: selectedCategory || undefined,
        search: search || undefined,
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [fetchMemories, selectedPersonaId, selectedCategory, search]);

  // Build persona lookup
  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) {
      map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    }
    return map;
  }, [personas]);

  const hasFilters = !!selectedPersonaId || !!selectedCategory || !!search;

  const clearFilters = useCallback(() => {
    setSearch('');
    setSelectedPersonaId(null);
    setSelectedCategory(null);
  }, []);

  // Server-side search — memories are already filtered by the backend
  const filteredMemories = memories;

  const toggleSort = useCallback((column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: column === 'importance' ? 'desc' : 'desc' },
    );
  }, []);

  const sortedMemories = useMemo(() => {
    const sorted = [...filteredMemories];
    const dir = sort.direction === 'asc' ? 1 : -1;
    if (sort.column === 'importance') {
      sorted.sort((a, b) => (a.importance - b.importance) * dir);
    } else {
      sorted.sort((a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir);
    }
    return sorted;
  }, [filteredMemories, sort]);

  const { parentRef: memoryListRef, virtualizer } = useVirtualList(sortedMemories, 48);

  // AI Review handler
  const handleReview = useCallback(async () => {
    setIsReviewing(true);
    setReviewResult(null);
    setReviewError(null);
    try {
      const result = await reviewMemories(selectedPersonaId || undefined);
      setReviewResult(result);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReviewing(false);
    }
  }, [reviewMemories, selectedPersonaId]);

  const closeReviewModal = useCallback(() => {
    setReviewResult(null);
    setReviewError(null);
  }, []);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Agent Memories"
        subtitle={`${memoriesTotal} memor${memoriesTotal !== 1 ? 'ies' : 'y'} stored by agents`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleReview}
              disabled={isReviewing || memoriesTotal === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-all bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40"
            >
              {isReviewing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {isReviewing ? 'Reviewing...' : 'Review with AI'}
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-all ${
                showAddForm
                  ? 'bg-violet-500/30 text-violet-200 border-violet-500/40'
                  : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'
              }`}
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
              Add Memory
            </button>
          </div>
        }
      >
        {/* Filter bar */}
        <div className="mt-4">
          <MemoryFilterBar
            search={search}
            onSearchChange={setSearch}
            selectedPersonaId={selectedPersonaId}
            onPersonaChange={setSelectedPersonaId}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            personas={personas}
          />
        </div>
      </ContentHeader>

      {/* Inline Add Memory Form */}
      <AnimatePresence>
        {showAddForm && (
          <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />
        )}
      </AnimatePresence>

      {/* Table */}
      <ContentBody flex>
        <div className="px-4 md:px-6 py-2 text-sm font-mono text-muted-foreground/80 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
          Showing {sortedMemories.length} of {memoriesTotal} memories
        </div>

        {filteredMemories.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground/80">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
              <Brain className="w-8 h-8 text-violet-400/40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">No memories yet</p>
              <p className="text-sm text-muted-foreground/80 mt-1 max-w-xs">
                {hasFilters
                  ? 'No memories match your filters. Try adjusting your search.'
                  : 'When agents run, they can store valuable notes and learnings here.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Table header (desktop only) */}
            <div className="hidden md:flex items-center gap-4 px-6 py-2 bg-secondary/30 border-b border-primary/10 sticky top-0 z-10">
              <span className="w-[140px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Agent</span>
              <span className="flex-1 text-sm font-mono uppercase text-muted-foreground/80">Title</span>
              <span className="w-[70px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Category</span>
              <button
                onClick={() => toggleSort('importance')}
                className={`w-[60px] flex items-center gap-0.5 text-sm font-mono uppercase flex-shrink-0 transition-colors rounded-md px-1.5 py-0.5 hover:bg-secondary/30 ${sort.column === 'importance' ? 'text-foreground/90 font-semibold border-b-2 border-primary/40' : 'text-muted-foreground/80 hover:text-muted-foreground'}`}
              >
                Priority
                {sort.column === 'importance' ? (
                  sort.direction === 'asc' ? <ChevronUp className="w-3 h-3 transition-transform duration-200" /> : <ChevronDown className="w-3 h-3 transition-transform duration-200" />
                ) : (
                  <ChevronDown className="w-3 h-3 opacity-30 transition-transform duration-200" />
                )}
              </button>
              <span className="w-[120px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Tags</span>
              <button
                onClick={() => toggleSort('created_at')}
                className={`w-[60px] flex items-center justify-end gap-0.5 text-sm font-mono uppercase flex-shrink-0 transition-colors rounded-md px-1.5 py-0.5 hover:bg-secondary/30 ${sort.column === 'created_at' ? 'text-foreground/90 font-semibold border-b-2 border-primary/40' : 'text-muted-foreground/80 hover:text-muted-foreground'}`}
              >
                Created
                {sort.column === 'created_at' ? (
                  sort.direction === 'asc' ? <ChevronUp className="w-3 h-3 transition-transform duration-200" /> : <ChevronDown className="w-3 h-3 transition-transform duration-200" />
                ) : (
                  <ChevronDown className="w-3 h-3 opacity-30 transition-transform duration-200" />
                )}
              </button>
              <span className="w-[32px] flex-shrink-0" />
              <span className="w-[14px] flex-shrink-0" />
            </div>

            {/* Rows */}
            <div ref={memoryListRef} className="flex-1 overflow-y-auto">
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const memory = sortedMemories[virtualRow.index]!;
                  const persona = personaMap.get(memory.persona_id);
                  return (
                    <div
                      key={memory.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        transform: `translateY(${virtualRow.start}px)`,
                        width: '100%',
                      }}
                    >
                      <MemoryRow
                        memory={memory}
                        personaName={persona?.name || 'Unknown'}
                        personaColor={persona?.color || '#6B7280'}
                        onDelete={() => deleteMemory(memory.id)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </ContentBody>

      {/* Review Results Modal */}
      <AnimatePresence>
        {(reviewResult || reviewError) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closeReviewModal}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl mx-4 bg-background border border-primary/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b border-primary/10 flex-shrink-0">
                <div className="flex-1 min-w-0 pr-4">
                  <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    AI Memory Review
                  </h3>
                  {reviewResult && (
                    <p className="text-sm text-muted-foreground/80 mt-1">
                      Reviewed {reviewResult.reviewed} memories
                    </p>
                  )}
                </div>
                <button
                  onClick={closeReviewModal}
                  className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground/95 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5">
                {reviewError ? (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-300">Review failed</p>
                      <p className="text-sm text-red-400/70 mt-1">{reviewError}</p>
                    </div>
                  </div>
                ) : reviewResult ? (
                  <div className="space-y-4">
                    {/* Summary badges */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-sm font-medium text-emerald-300">{reviewResult.updated} kept</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        <span className="text-sm font-medium text-red-300">{reviewResult.deleted} pruned</span>
                      </div>
                    </div>

                    {/* Details list */}
                    {reviewResult.details.length > 0 && (
                      <div className="space-y-1.5">
                        {reviewResult.details.map((d) => (
                          <div
                            key={d.id}
                            className={`flex items-start gap-3 px-3 py-2 rounded-lg border ${
                              d.action === 'deleted'
                                ? 'bg-red-500/5 border-red-500/15'
                                : 'bg-emerald-500/5 border-emerald-500/15'
                            }`}
                          >
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md flex-shrink-0 mt-0.5 ${
                              d.score >= 7
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : d.score >= 4
                                  ? 'bg-amber-500/15 text-amber-400'
                                  : 'bg-red-500/15 text-red-400'
                            }`}>
                              {d.score}/10
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-medium truncate ${
                                d.action === 'deleted' ? 'text-foreground/50 line-through' : 'text-foreground/80'
                              }`}>
                                {d.title}
                              </p>
                              <p className="text-xs text-muted-foreground/70 mt-0.5">{d.reason}</p>
                            </div>
                            <span className={`text-xs font-medium flex-shrink-0 ${
                              d.action === 'deleted' ? 'text-red-400/70' : 'text-emerald-400/70'
                            }`}>
                              {d.action}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </ContentBox>
  );
}
