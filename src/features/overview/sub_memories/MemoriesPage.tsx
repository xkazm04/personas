import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Brain } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { MemoryRow } from '@/features/overview/sub_memories/components/MemoryCard';
import { InlineAddMemoryForm } from '@/features/overview/sub_memories/components/CreateMemoryForm';
import { MemoryFilterBar } from '@/features/overview/sub_memories/components/MemoryFilterBar';
import { MemoryConflictReview } from '@/features/overview/sub_memories/components/MemoryConflictReview';
import { MemoryTableHeader } from '@/features/overview/sub_memories/components/MemoryTableHeader';
import { MemoryEmptyState } from '@/features/overview/sub_memories/components/MemoryEmptyState';
import { MemoryHeaderActions } from '@/features/overview/sub_memories/components/MemoryHeaderActions';
import ReviewResultsModal from '@/features/overview/sub_memories/components/ReviewResultsModal';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import type { MemoryReviewResult } from '@/api/overview/memories';
import type { SortColumn, SortState } from '@/features/overview/sub_memories/components/MemoryTableHeader';

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
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchMemories, selectedPersonaId, selectedCategory, search]);

  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    return map;
  }, [personas]);

  const hasFilters = !!selectedPersonaId || !!selectedCategory || !!search;
  const clearFilters = useCallback(() => { setSearch(''); setSelectedPersonaId(null); setSelectedCategory(null); }, []);

  const toggleSort = useCallback((column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'desc' },
    );
  }, []);

  const sortedMemories = useMemo(() => {
    const sorted = [...memories];
    const dir = sort.direction === 'asc' ? 1 : -1;
    if (sort.column === 'importance') sorted.sort((a, b) => (a.importance - b.importance) * dir);
    else sorted.sort((a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir);
    return sorted;
  }, [memories, sort]);

  const { parentRef: memoryListRef, virtualizer } = useVirtualList(sortedMemories, 48);

  const handleReview = useCallback(async () => {
    setIsReviewing(true); setReviewResult(null); setReviewError(null);
    try { setReviewResult(await reviewMemories(selectedPersonaId || undefined)); }
    catch (err) { setReviewError(err instanceof Error ? err.message : String(err)); }
    finally { setIsReviewing(false); }
  }, [reviewMemories, selectedPersonaId]);

  const closeReviewModal = useCallback(() => { setReviewResult(null); setReviewError(null); }, []);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />} iconColor="violet"
        title="Agent Memories"
        subtitle={`${memoriesTotal} memor${memoriesTotal !== 1 ? 'ies' : 'y'} stored by agents`}
        actions={
          <MemoryHeaderActions isReviewing={isReviewing} memoriesTotal={memoriesTotal}
            showAddForm={showAddForm} onReview={handleReview} onToggleAddForm={() => setShowAddForm((v) => !v)} />
        }
      >
        <div className="mt-4">
          <MemoryFilterBar
            search={search} onSearchChange={setSearch}
            selectedPersonaId={selectedPersonaId} onPersonaChange={setSelectedPersonaId}
            selectedCategory={selectedCategory} onCategoryChange={setSelectedCategory}
            hasFilters={hasFilters} onClearFilters={clearFilters} personas={personas}
          />
        </div>
      </ContentHeader>

      <AnimatePresence>{showAddForm && <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />}</AnimatePresence>
      {memories.length > 1 && <div className="py-2"><MemoryConflictReview /></div>}

      <ContentBody flex>
        <div className="px-4 md:px-6 py-2 text-sm font-mono text-muted-foreground/80 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
          Showing {sortedMemories.length} of {memoriesTotal} memories
        </div>
        {memories.length === 0 ? (
          <MemoryEmptyState hasFilters={hasFilters} />
        ) : (
          <>
            <MemoryTableHeader sort={sort} onToggleSort={toggleSort} />
            <div ref={memoryListRef} className="flex-1 overflow-y-auto">
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((vr) => {
                  const m = sortedMemories[vr.index]!;
                  const p = personaMap.get(m.persona_id);
                  return (
                    <div key={m.id} style={{ position: 'absolute', top: 0, transform: `translateY(${vr.start}px)`, width: '100%' }}>
                      <MemoryRow memory={m} personaName={p?.name || 'Unknown'} personaColor={p?.color || '#6B7280'} onDelete={() => deleteMemory(m.id)} />
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </ContentBody>

      <AnimatePresence>
        <ReviewResultsModal reviewResult={reviewResult} reviewError={reviewError} onClose={closeReviewModal} />
      </AnimatePresence>
    </ContentBox>
  );
}
