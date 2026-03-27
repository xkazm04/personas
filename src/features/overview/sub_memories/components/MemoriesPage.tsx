import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Brain, Plus, Sparkles, Search, X, Bot, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { ImportanceDots, TierBadge } from './MemoryCard';
import { InlineAddMemoryForm } from './CreateMemoryForm';
import { MemoryConflictReview } from './MemoryConflictReview';
import ReviewResultsModal from './ReviewResultsModal';
import MemoryDetailModal from './MemoryDetailModal';
import { formatRelativeTime, MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import type { MemoryReviewResult } from '@/api/overview/memories';
import type { PersonaMemory } from '@/lib/types/types';
import { seedMockMemory } from '@/api/overview/memories';
import { createLogger } from "@/lib/log";

const logger = createLogger("memories-page");

const TIER_OPTIONS = [
  { value: 'all', label: 'All tiers' },
  { value: 'core', label: 'Core' },
  { value: 'active', label: 'Active' },
  { value: 'archive', label: 'Archive' },
];

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All categories' },
  ...ALL_MEMORY_CATEGORIES.map((cat) => ({
    value: cat,
    label: MEMORY_CATEGORY_COLORS[cat]?.label ?? cat,
  })),
];

export default function MemoriesPage() {
  const personas = useAgentStore((s) => s.personas);
  const {
    memories, memoriesTotal, fetchMemories, deleteMemory, reviewMemories, setMemoryTier,
  } = useOverviewStore(useShallow((s) => ({
    memories: s.memories,
    memoriesTotal: s.memoriesTotal,
    fetchMemories: s.fetchMemories,
    deleteMemory: s.deleteMemory,
    reviewMemories: s.reviewMemories,
    setMemoryTier: s.setMemoryTier,
  })));

  const [search, setSearch] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedTier, setSelectedTier] = useState('all');
  const latestFilterRequestRef = useRef(0);
  const [sortKey, setSortKey] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showAddForm, setShowAddForm] = useState(false);

  const [selectedMemory, setSelectedMemory] = useState<PersonaMemory | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<MemoryReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Fetch from backend with debounce
  useEffect(() => {
    const requestId = ++latestFilterRequestRef.current;
    const timer = setTimeout(() => {
      if (requestId !== latestFilterRequestRef.current) return;
      fetchMemories({
        persona_id: selectedPersonaId || undefined,
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        search: search || undefined,
        sort_column: sortKey,
        sort_direction: sortDirection,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchMemories, selectedPersonaId, selectedCategory, search, sortKey, sortDirection]);

  // Client-side tier filter (backend doesn't support tier filtering yet)
  const filteredMemories = useMemo(() => {
    if (selectedTier === 'all') return memories;
    return memories.filter((m) => m.tier === selectedTier);
  }, [memories, selectedTier]);

  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    return map;
  }, [personas]);

  const personaOptions = useMemo(() => [
    { value: '', label: 'All agents' },
    ...personas.map((p) => ({ value: p.id, label: p.name })),
  ], [personas]);

  const hasFilters = !!selectedPersonaId || selectedCategory !== 'all' || selectedTier !== 'all' || !!search;
  const clearFilters = useCallback(() => {
    setSearch('');
    setSelectedPersonaId('');
    setSelectedCategory('all');
    setSelectedTier('all');
  }, []);

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDirection((d) => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDirection('desc');
      return key;
    });
  }, []);

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
    catch (err) { logger.error('Failed to seed mock memory', { error: err }); }
  }, [fetchMemories]);

  // -- DataGrid columns ---------------------------------------------------
  const columns: DataGridColumn<PersonaMemory>[] = useMemo(() => [
    {
      key: 'persona_id',
      label: 'Agent',
      width: '1.2fr',
      filterOptions: personaOptions,
      filterValue: selectedPersonaId,
      onFilterChange: setSelectedPersonaId,
      render: (memory) => {
        const p = personaMap.get(memory.persona_id);
        return (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg, ${p?.color ?? '#6B7280'}20, ${p?.color ?? '#6B7280'}40)`, border: `1px solid ${p?.color ?? '#6B7280'}50` }}>
              <Bot className="w-2.5 h-2.5" style={{ color: p?.color ?? '#6B7280' }} />
            </div>
            <span className="text-sm text-foreground/90 truncate">{p?.name ?? 'Unknown'}</span>
          </div>
        );
      },
    },
    {
      key: 'title',
      label: 'Title',
      width: '2fr',
      render: (memory) => (
        <span className="text-sm text-foreground/80 truncate" title={memory.title}>{stripHtml(memory.title)}</span>
      ),
    },
    {
      key: 'tier',
      label: 'Tier',
      width: '0.7fr',
      filterOptions: TIER_OPTIONS,
      filterValue: selectedTier,
      onFilterChange: setSelectedTier,
      render: (memory) => (
        <div className="flex items-center gap-1">
          <TierBadge tier={memory.tier} />
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      width: '0.8fr',
      filterOptions: CATEGORY_OPTIONS,
      filterValue: selectedCategory,
      onFilterChange: setSelectedCategory,
      render: (memory) => {
        const cat = MEMORY_CATEGORY_COLORS[memory.category] ?? { label: memory.category, bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' };
        return (
          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded-md border ${cat.bg} ${cat.text} ${cat.border}`}>
            {cat.label}
          </span>
        );
      },
    },
    {
      key: 'importance',
      label: 'Priority',
      width: '0.7fr',
      sortable: true,
      render: (memory) => <ImportanceDots value={memory.importance} />,
    },
    {
      key: 'created_at',
      label: 'Created',
      width: '0.6fr',
      sortable: true,
      align: 'right' as const,
      render: (memory) => (
        <span className="text-xs text-muted-foreground/70">{formatRelativeTime(memory.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '60px',
      render: (memory) => (
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {memory.tier !== 'core' && (
            <button onClick={() => setMemoryTier(memory.id, 'core')} title="Promote to Core" className="p-1 rounded hover:bg-amber-500/10 text-muted-foreground/50 hover:text-amber-400 transition-colors">
              <ArrowUp className="w-3 h-3" />
            </button>
          )}
          {memory.tier !== 'archive' && (
            <button onClick={() => setMemoryTier(memory.id, 'archive')} title="Archive" className="p-1 rounded hover:bg-zinc-500/10 text-muted-foreground/50 hover:text-zinc-400 transition-colors">
              <ArrowDown className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => deleteMemory(memory.id)} title="Delete" className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-400 transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ),
    },
  ], [personaOptions, selectedPersonaId, selectedTier, selectedCategory, personaMap, setMemoryTier, deleteMemory]);

  // -- Tier-based row accent ------------------------------------------------
  const getRowAccent = useCallback((memory: PersonaMemory) => {
    if (memory.tier === 'core') return 'hover:border-l-amber-400';
    if (memory.tier === 'archive') return 'hover:border-l-zinc-400';
    return 'hover:border-l-violet-400';
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
            {import.meta.env.DEV && (
              <button onClick={handleSeedMemory} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title="Seed a mock memory (dev only)">
                <Plus className="w-3.5 h-3.5" /> Mock Memory
              </button>
            )}
            <button onClick={handleReview} disabled={isReviewing || memoriesTotal === 0} title={isReviewing ? 'Review in progress...' : memoriesTotal === 0 ? 'No memories to review' : undefined} className="flex items-center gap-1.5 px-3 py-2 typo-heading rounded-xl border transition-all bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">
              {isReviewing ? <LoadingSpinner size="sm" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isReviewing ? 'Reviewing...' : 'Review with AI'}
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 typo-heading rounded-xl border transition-all ${showAddForm ? 'bg-violet-500/30 text-violet-200 border-violet-500/40' : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'}`}
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
              Add Memory
            </button>
          </div>
        }
      >
        {/* Search bar */}
        <div className="mt-4 flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-secondary/50 border border-primary/15 rounded-xl outline-none focus-visible:border-primary/30 text-foreground/80 placeholder:text-muted-foreground/60"
            />
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 px-2.5 py-2 text-sm text-muted-foreground/80 hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors">
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </ContentHeader>

      {showAddForm && <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />}

      {memories.length > 1 && <div className="py-2"><MemoryConflictReview /></div>}

      <ContentBody flex>
        <DataGrid<PersonaMemory>
          columns={columns}
          data={filteredMemories}
          getRowKey={(m) => m.id}
          onRowClick={setSelectedMemory}
          getRowAccent={getRowAccent}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={handleSort}
          pageSize={25}
          pageSizeOptions={[10, 25, 50, 100]}
          emptyIcon={Brain}
          emptyTitle="No memories yet"
          emptyDescription={hasFilters ? 'No memories match your filters. Try adjusting your search.' : 'When agents run, they can store valuable notes and learnings here.'}
          className="flex-1 min-h-0"
        />
      </ContentBody>

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
