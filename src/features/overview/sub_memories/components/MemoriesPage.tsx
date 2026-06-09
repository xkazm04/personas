import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Brain, Plus, Search, X, Sparkles, Shield, Layers, Table2, GitFork, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { PersonaColumnFilter } from '@/features/shared/components/forms/PersonaColumnFilter';
import { ColumnDropdownFilter } from '@/features/shared/components/forms/ColumnDropdownFilter';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { MemoryTierFilter } from '@/api/overview/memories';
import { useColumnWidths, ColumnResizeHandle } from '@/features/shared/components/display/ColumnResize';
import { MotionEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { MemoryRow } from './MemoryCard';
import { InlineAddMemoryForm } from './CreateMemoryForm';
import { MemoryConflictReview } from './MemoryConflictReview';
import ReviewResultsModal from './ReviewResultsModal';
import MemoryDetailModal from './MemoryDetailModal';
import { GroupedVirtualList } from '@/features/shared/components/display/GroupedVirtualList';
import { timeGroupKey, timeGroupLabels } from '@/features/shared/components/display/grouping';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import { categoryColor, importanceColor } from '../libs/memoryVisualTokens';
import type { PersonaMemory } from '@/lib/types/types';
import MemoriesPageDense from './MemoriesPageDense';
import MemoriesPageGraph from './MemoriesPageGraph';
import { DebtText, debtText } from '@/i18n/DebtText';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { deleteAllMemories } from '@/api/overview/memories';
import { toastCatch } from '@/lib/silentCatch';


// -- Prototype tab switcher (throwaway scaffold) -----------------------------
// Three directional variants of the same data + actions surface:
//  - "baseline" - the current virtualized list (default)
//  - "dense"    - numeric KPI strip + sortable 8-column matrix
//  - "graph"    - SVG cluster layout, memories grouped by category
type PrototypeVariant = 'baseline' | 'dense' | 'graph';

const VARIANT_TABS: { key: PrototypeVariant; label: string; subtitle: string; icon: typeof Brain }[] = [
  { key: 'baseline', label: 'Baseline', subtitle: 'current production layout', icon: Layers },
  { key: 'dense', label: 'Dense', subtitle: 'KPI strip + sortable matrix', icon: Table2 },
  { key: 'graph', label: 'Graph', subtitle: 'category clusters with persona edges', icon: GitFork },
];

export default function MemoriesPage() {
  const [variant, setVariant] = useState<PrototypeVariant>('baseline');

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <PrototypeTabStrip variant={variant} setVariant={setVariant} />
      {variant === 'baseline' && <MemoriesPageBaseline />}
      {variant === 'dense' && <MemoriesPageDense />}
      {variant === 'graph' && <MemoriesPageGraph />}
    </div>
  );
}

function PrototypeTabStrip({ variant, setVariant }: { variant: PrototypeVariant; setVariant: (v: PrototypeVariant) => void }) {
  return (
    <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
      <span className="typo-label text-foreground">Prototype</span>
      <div className="flex items-center gap-1 rounded-modal border border-primary/15 bg-background/50 p-1">
        {VARIANT_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = variant === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setVariant(tab.key)}
              title={tab.subtitle}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-input typo-body font-medium transition-all ${
                active
                  ? 'bg-primary/15 text-foreground border border-primary/25 shadow-elevation-1'
                  : 'text-foreground hover:text-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
      <span className="typo-caption text-foreground hidden md:inline">
        {VARIANT_TABS.find((t) => t.key === variant)?.subtitle}
      </span>
    </div>
  );
}

type SortColumn = 'importance' | 'created_at';
type SortDirection = 'asc' | 'desc';
interface SortState { column: SortColumn; direction: SortDirection }

type ViewTab = 'memories' | 'conflicts';

// Ordered columns for the memory grid. Widths are defaults — users can
// drag-resize them; overrides persist via useColumnWidths('overview-memories').
// The header (here) and each MemoryRow share this template so columns align.
const MEMORY_COLUMNS: { key: string; width: string }[] = [
  { key: 'persona', width: '180px' },
  { key: 'title', width: 'minmax(0,2fr)' },
  { key: 'category', width: '100px' },
  { key: 'priority', width: '80px' },
  { key: 'created', width: '100px' },
  { key: 'actions', width: '40px' },
];

function MemoriesPageBaseline() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const {
    memories, memoriesTotal, memoriesLoading, memoriesError, memoryStats, fetchMemories, deleteMemory, setMemoryTier, reviewMemories,
    memoryReviewRunning, memoryReviewResult, memoryReviewError, clearMemoryReviewResult,
  } = useOverviewStore(useShallow((s) => ({
    memories: s.memories,
    memoriesTotal: s.memoriesTotal,
    memoriesLoading: s.memoriesLoading,
    memoriesError: s.memoriesError,
    memoryStats: s.memoryStats,
    fetchMemories: s.fetchMemories,
    deleteMemory: s.deleteMemory,
    setMemoryTier: s.setMemoryTier,
    reviewMemories: s.reviewMemories,
    memoryReviewRunning: s.memoryReviewRunning,
    memoryReviewResult: s.memoryReviewResult,
    memoryReviewError: s.memoryReviewError,
    clearMemoryReviewResult: s.clearMemoryReviewResult,
  })));

  const [search, setSearch] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<MemoryTierFilter | null>(null);
  const latestFilterRequestRef = useRef(0);
  const [sort] = useState<SortState>({ column: 'created_at', direction: 'desc' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [viewTab, setViewTab] = useState<ViewTab>('memories');

  const [selectedMemory, setSelectedMemory] = useState<PersonaMemory | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);

  useEffect(() => {
    const requestId = ++latestFilterRequestRef.current;
    const timer = setTimeout(() => {
      if (requestId !== latestFilterRequestRef.current) return;
      fetchMemories({
        persona_id: selectedPersonaId || undefined,
        category: selectedCategory || undefined,
        search: search || undefined,
        tier: selectedTier || undefined,
        sort_column: sort.column,
        sort_direction: sort.direction,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchMemories, selectedPersonaId, selectedCategory, search, selectedTier, sort]);

  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    return map;
  }, [personas]);

  const hasFilters = !!selectedPersonaId || !!selectedCategory || !!search || !!selectedTier;
  const clearFilters = useCallback(() => { setSearch(''); setSelectedPersonaId(null); setSelectedCategory(null); setSelectedTier(null); }, []);

  const colWidths = useColumnWidths('overview-memories');
  const memGridTemplate = colWidths.template(MEMORY_COLUMNS);

  // Bucket the (created-at desc) list under sticky day headers for temporal
  // wayfinding. Restore the scroll offset across tab/route/persona switches; a
  // new (persona, category, tier) context starts at the top.
  const groupLabels = useMemo(() => timeGroupLabels(t), [t]);
  const groupOf = useCallback(
    (memory: PersonaMemory) => {
      const key = timeGroupKey(memory.created_at);
      return { key, label: groupLabels[key] };
    },
    [groupLabels],
  );
  const memoryScrollRestoreKey = `overview/memories|persona=${selectedPersonaId ?? 'all'}|cat=${selectedCategory ?? 'all'}|tier=${selectedTier ?? 'all'}`;
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

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
      if (pendingDeleteId === memories[focusedIndex]!.id) {
        deleteMemory(pendingDeleteId);
        setPendingDeleteId(null);
      } else {
        setSelectedMemory(memories[focusedIndex]!);
      }
    } else if (e.key === 'Delete' && focusedIndex >= 0 && focusedIndex < memories.length) {
      e.preventDefault();
      const memId = memories[focusedIndex]!.id;
      if (pendingDeleteId === memId) {
        deleteMemory(memId);
        setPendingDeleteId(null);
      } else {
        setPendingDeleteId(memId);
      }
    } else if (e.key === 'Escape') {
      setPendingDeleteId(null);
    }
  }, [memories, focusedIndex, deleteMemory, pendingDeleteId]);

  const handleReview = useCallback(() => {
    // Fire-and-forget: the slice owns the in-flight task + result, so this
    // survives unmount (e.g. user switches tabs while the CLI review runs).
    void reviewMemories(selectedPersonaId || undefined).catch(() => {
      // Slice already records memoryReviewError; toast is surfaced by reportError.
    });
  }, [reviewMemories, selectedPersonaId]);

  const categoryFilterOptions = useMemo(() => {
    const categoryItems = ALL_MEMORY_CATEGORIES.map((cat) => ({
      value: cat,
      label: MEMORY_CATEGORY_COLORS[cat]?.label ?? cat,
    })).sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: '', label: 'All categories' }, ...categoryItems];
  }, []);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.overview.memories.title}
        subtitle={`${memoriesTotal} memor${memoriesTotal !== 1 ? 'ies' : 'y'} stored by agents`}
        actions={
          <div className="flex items-center gap-2">
            {/* Tab toggles */}
            <button
              onClick={() => setViewTab('memories')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal transition-colors ${
                viewTab === 'memories'
                  ? 'bg-primary/10 text-foreground border border-primary/20'
                  : 'text-foreground hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15'
              }`}
            >
              <Brain className="w-4 h-4" />
              <span className="typo-body font-medium">Memories</span>
            </button>
            <button
              onClick={() => setViewTab('conflicts')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal transition-colors ${
                viewTab === 'conflicts'
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/25'
                  : 'text-foreground hover:text-muted-foreground bg-secondary/30 hover:bg-secondary/50 border border-primary/15'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span className="typo-body font-medium">Conflicts</span>
            </button>

            <div className="w-px h-6 bg-primary/10" />

            <button onClick={handleReview} disabled={memoryReviewRunning || memoriesTotal === 0} title={memoryReviewRunning ? 'Review running in background — you can switch tabs and come back' : memoriesTotal === 0 ? 'No memories to review' : undefined} className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-modal border transition-all bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">
              {memoryReviewRunning ? <LoadingSpinner size="sm" /> : <Sparkles className="w-3.5 h-3.5" />}
              {memoryReviewRunning ? 'Reviewing...' : 'Review'}
            </button>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-modal border transition-all ${showAddForm ? 'bg-violet-500/30 text-violet-200 border-violet-500/40' : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'}`}
            >
              <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
              Add
            </button>
            {memoriesTotal > 0 && (
              <button
                onClick={() => setConfirmingDeleteAll(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-heading rounded-modal border transition-all bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25"
                title={t.overview.memories.delete_all}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        }
      />

      {confirmingDeleteAll && (
        <ConfirmDialog
          title={t.overview.memories.delete_all_confirm_title}
          body={tx(t.overview.memories.delete_all_confirm_body, { count: memoriesTotal })}
          danger
          confirmLabel={t.overview.memories.delete_all_confirm_cta}
          onConfirm={async () => {
            try {
              await deleteAllMemories();
              await fetchMemories();
            } catch (e) {
              toastCatch('MemoriesPageBaseline:deleteAll', 'Failed to delete all memories')(e);
            } finally {
              setConfirmingDeleteAll(false);
            }
          }}
          onCancel={() => setConfirmingDeleteAll(false)}
        />
      )}

      {showAddForm && <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />}

      {viewTab === 'conflicts' ? (
        <ContentBody flex>
          <div className="flex-1 overflow-y-auto p-4">
            <MemoryConflictReview />
          </div>
        </ContentBody>
      ) : (
        <ContentBody flex>
          {/* Consolidated search + stats row */}
          <div className="flex items-center gap-3 px-4 md:px-6 py-1.5 border-b border-primary/10 bg-secondary/5 flex-shrink-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={debtText("auto_search_memories_bc414f95")}
                className="w-full pl-8 pr-8 py-1.5 typo-body rounded-card bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:border-primary/30 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-foreground hover:text-foreground/70">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <ThemedSelect
              value={selectedTier || ''}
              onChange={(e) => setSelectedTier((e.target.value || null) as MemoryTierFilter | null)}
              wrapperClassName="min-w-[116px] flex-shrink-0"
            >
              <option value="">{t.overview.memory_filter.tier_all}</option>
              <option value="core">{t.overview.memory_filter.tier_core}</option>
              <option value="active">{t.overview.memory_filter.tier_active}</option>
              <option value="working">{t.overview.memory_filter.tier_working}</option>
              <option value="archive">{t.overview.memory_filter.tier_archived}</option>
            </ThemedSelect>
            {memoryStats && memoryStats.total > 0 && (
              <>
                <span className="typo-code font-mono text-foreground flex-shrink-0 tabular-nums">{memoryStats.total} total</span>
                <div className="flex items-center gap-1.5 flex-shrink-0" title={`Avg importance: ${memoryStats.avg_importance.toFixed(1)}/5`}>
                  <svg width="18" height="18" viewBox="0 0 18 18" className="flex-shrink-0">
                    <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground" />
                    <circle cx="9" cy="9" r="7" fill="none" stroke={importanceColor(memoryStats.avg_importance)}
                      strokeWidth="2" strokeDasharray={`${((memoryStats.avg_importance / 5) * 100 / 100) * 44} 44`} strokeLinecap="round" transform="rotate(-90 9 9)" style={{ transition: 'stroke-dasharray 300ms' }} />
                  </svg>
                  <span className="typo-caption text-foreground tabular-nums">{memoryStats.avg_importance.toFixed(1)}</span>
                </div>
                {memoryStats.category_counts.length > 0 && (
                  <div className="flex h-2 rounded-full overflow-hidden flex-1 bg-muted-foreground/10">
                    {memoryStats.category_counts.map(([cat, count]) => (
                      <div key={cat} title={`${MEMORY_CATEGORY_COLORS[cat]?.label ?? cat}: ${count}`} className="h-full"
                        style={{ width: `${(count / (memoryStats.total || 1)) * 100}%`, backgroundColor: categoryColor(cat).hex, transition: 'width 300ms', minWidth: count > 0 ? '2px' : 0 }} />
                    ))}
                  </div>
                )}
              </>
            )}
            <span className="typo-code font-mono text-foreground flex-shrink-0">{memories.length}/{memoriesTotal}</span>
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 px-2 py-1.5 typo-caption rounded-card bg-secondary/40 text-foreground border border-primary/10 hover:bg-secondary/60 transition-colors">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {memoriesLoading && memories.length === 0 ? (
            // eslint-disable-next-line custom/no-hardcoded-jsx-text
            <div className="flex-1 p-4 space-y-2" aria-busy="true" aria-label="Loading memories">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 rounded-card bg-secondary/30 animate-pulse" />
              ))}
            </div>
          ) : memoriesError && memories.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="max-w-sm w-full rounded-modal border border-red-500/20 bg-red-500/5 p-4 text-center space-y-3">
                <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
                <p className="typo-body text-foreground">{memoriesError}</p>
                <button
                  onClick={() => void fetchMemories()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-red-500/15 text-red-300 border border-red-500/25 hover:bg-red-500/25 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            </div>
          ) : memories.length === 0 && !hasFilters ? (
            <div className="flex-1 flex items-center justify-center">
              <MotionEmptyState
                motif="memories"
                content={{
                  icon: Brain,
                  title: debtText("auto_no_memories_yet_775ad944"),
                  subtitle: debtText("auto_when_agents_run_they_can_store_valuable_no_4c99046a"),
                }}
              />
            </div>
          ) : (
            <>
              {/* Column headers with inline filters */}
              <div className="hidden md:grid gap-0 border-b border-primary/10 bg-background sticky top-0 z-10" style={{ gridTemplateColumns: memGridTemplate }}>
                <div className="relative px-4 py-1.5 flex items-center">
                  <PersonaColumnFilter
                    value={selectedPersonaId ?? ''}
                    onChange={(v) => setSelectedPersonaId(v || null)}
                    personas={personas}
                  />
                  <ColumnResizeHandle
                    label={t.shared.resize_column}
                    onBeginResize={(w, x) => colWidths.beginResize('persona', w, x)}
                    onReset={() => colWidths.clearColumn('persona')}
                  />
                </div>
                <div className="relative flex items-center px-4 py-1.5 typo-label text-foreground">
                  Title
                  <ColumnResizeHandle
                    label={t.shared.resize_column}
                    onBeginResize={(w, x) => colWidths.beginResize('title', w, x)}
                    onReset={() => colWidths.clearColumn('title')}
                  />
                </div>
                <div className="relative px-2 py-1.5 flex items-center">
                  <ColumnDropdownFilter
                    label="Type"
                    value={selectedCategory ?? ''}
                    options={categoryFilterOptions}
                    onChange={(v) => setSelectedCategory(v || null)}
                    allValue=""
                  />
                  <ColumnResizeHandle
                    label={t.shared.resize_column}
                    onBeginResize={(w, x) => colWidths.beginResize('category', w, x)}
                    onReset={() => colWidths.clearColumn('category')}
                  />
                </div>
                <div className="relative flex items-center px-4 py-1.5 typo-label text-foreground">
                  Priority
                  <ColumnResizeHandle
                    label={t.shared.resize_column}
                    onBeginResize={(w, x) => colWidths.beginResize('priority', w, x)}
                    onReset={() => colWidths.clearColumn('priority')}
                  />
                </div>
                <div className="flex items-center justify-end px-4 py-1.5 typo-label text-foreground">Created</div>
                <div className="px-2 py-1.5" />
              </div>

              {memories.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="typo-body text-foreground"><DebtText k="auto_no_memories_match_current_filters_06cb075f" /></p>
                </div>
              ) : (
                <GroupedVirtualList<PersonaMemory>
                  items={memories}
                  groupOf={groupOf}
                  getItemKey={(memory) => memory.id}
                  estimateItemSize={48}
                  className={`flex-1 focus:outline-none ${colWidths.isResizing ? 'select-none cursor-col-resize' : ''}`}
                  scrollRestoreKey={memoryScrollRestoreKey}
                  scrollContainerProps={{ tabIndex: 0, role: 'grid', 'aria-label': debtText("auto_memory_list_a2a82929"), onKeyDown: handleListKeyDown }}
                  renderItem={(memory, index) => {
                    const persona = personaMap.get(memory.persona_id);
                    const isFocused = index === focusedIndex;
                    return (
                      <div data-index={index} role="row" aria-selected={isFocused} className={`h-full ${isFocused ? 'ring-1 ring-primary/40 ring-inset z-[1]' : ''} ${pendingDeleteId === memory.id ? 'bg-red-500/10' : ''}`}>
                        <MemoryRow memory={memory} personaName={persona?.name || 'Unknown'} index={index} gridTemplate={memGridTemplate} onDelete={() => deleteMemory(memory.id)} onSelect={() => setSelectedMemory(memory)} onRestore={() => setMemoryTier(memory.id, 'active')} />
                      </div>
                    );
                  }}
                />
              )}
            </>
          )}
        </ContentBody>
      )}

      <ReviewResultsModal reviewResult={memoryReviewResult} reviewError={memoryReviewError} onClose={clearMemoryReviewResult} />

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
