import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Brain, Plus, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { MemoryRow } from './MemoryCard';
import { InlineAddMemoryForm } from './CreateMemoryForm';
import { MemoryFilterBar } from './MemoryFilterBar';
import { MemoryConflictReview } from './MemoryConflictReview';
import ReviewResultsModal from './ReviewResultsModal';
import { useVirtualList } from '@/hooks/utility/interaction/useVirtualList';
import type { MemoryReviewResult } from '@/api/overview/memories';
import { seedMockMemory } from '@/api/overview/memories';

type SortColumn = 'importance' | 'created_at';
type SortDirection = 'asc' | 'desc';
interface SortState { column: SortColumn; direction: SortDirection }

export default function MemoriesPage() {
  const personas = useAgentStore((s) => s.personas);
  const memories = useOverviewStore((s) => s.memories);
  const memoriesTotal = useOverviewStore((s) => s.memoriesTotal);
  const fetchMemories = useOverviewStore((s) => s.fetchMemories);
  const deleteMemory = useOverviewStore((s) => s.deleteMemory);
  const reviewMemories = useOverviewStore((s) => s.reviewMemories);

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

  const toggleSort = useCallback((column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'desc' },
    );
  }, []);

  const { parentRef: memoryListRef, virtualizer } = useVirtualList(memories, 48);

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

  const handleSeedMemory = useCallback(async () => {
    try { await seedMockMemory(); await fetchMemories({}); }
    catch (err) { console.error('Failed to seed mock memory:', err); }
  }, [fetchMemories]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Agent Memories"
        subtitle={`${memoriesTotal} memor${memoriesTotal !== 1 ? 'ies' : 'y'} stored by agents`}
        actions={
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && (
              <button onClick={handleSeedMemory} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock memory (dev only)">
                <Plus className="w-3.5 h-3.5" /> Mock Memory
              </button>
            )}
            <button onClick={handleReview} disabled={isReviewing || memoriesTotal === 0} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border transition-all bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">
              {isReviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isReviewing ? 'Reviewing...' : 'Review with AI'}
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border transition-all ${showAddForm ? 'bg-violet-500/30 text-violet-200 border-violet-500/40' : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'}`}
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
              Add Memory
            </button>
          </div>
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
          Showing {memories.length} of {memoriesTotal} memories
        </div>

        {memories.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground/80">
            <div className="w-16 h-16 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
              <Brain className="w-8 h-8 text-violet-400/40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">No memories yet</p>
              <p className="text-sm text-muted-foreground/80 mt-1 max-w-xs">
                {hasFilters ? 'No memories match your filters. Try adjusting your search.' : 'When agents run, they can store valuable notes and learnings here.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <MemoryTableHeader sort={sort} onToggleSort={toggleSort} />
            <div ref={memoryListRef} className="flex-1 overflow-y-auto">
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const memory = memories[virtualRow.index]!;
                  const persona = personaMap.get(memory.persona_id);
                  return (
                    <div key={memory.id} style={{ position: 'absolute', top: 0, transform: `translateY(${virtualRow.start}px)`, width: '100%' }}>
                      <MemoryRow memory={memory} personaName={persona?.name || 'Unknown'} personaColor={persona?.color || '#6B7280'} onDelete={() => deleteMemory(memory.id)} />
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

// ---------------------------------------------------------------------------
// Table header (desktop only)
// ---------------------------------------------------------------------------

function MemoryTableHeader({ sort, onToggleSort }: { sort: SortState; onToggleSort: (col: SortColumn) => void }) {
  const SortIcon = ({ col }: { col: SortColumn }) =>
    sort.column === col
      ? sort.direction === 'asc' ? <ChevronUp className="w-3 h-3 transition-transform duration-200" /> : <ChevronDown className="w-3 h-3 transition-transform duration-200" />
      : <ChevronDown className="w-3 h-3 opacity-30 transition-transform duration-200" />;

  const sortBtnCls = (col: SortColumn) =>
    `flex items-center gap-0.5 text-sm font-mono uppercase flex-shrink-0 transition-colors rounded-lg px-1.5 py-0.5 hover:bg-secondary/30 ${sort.column === col ? 'text-foreground/90 font-semibold border-b-2 border-primary/40' : 'text-muted-foreground/80 hover:text-muted-foreground'}`;

  return (
    <div className="hidden md:flex items-center gap-4 px-6 py-2 bg-secondary/30 border-b border-primary/10 sticky top-0 z-10">
      <span className="w-[140px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Agent</span>
      <span className="flex-1 text-sm font-mono uppercase text-muted-foreground/80">Title</span>
      <span className="w-[70px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Category</span>
      <button onClick={() => onToggleSort('importance')} className={`w-[60px] ${sortBtnCls('importance')}`}>Priority<SortIcon col="importance" /></button>
      <span className="w-[120px] text-sm font-mono uppercase text-muted-foreground/80 flex-shrink-0">Tags</span>
      <button onClick={() => onToggleSort('created_at')} className={`w-[60px] justify-end ${sortBtnCls('created_at')}`}>Created<SortIcon col="created_at" /></button>
      <span className="w-[32px] flex-shrink-0" />
      <span className="w-[14px] flex-shrink-0" />
    </div>
  );
}
