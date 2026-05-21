// Dense — numeric KPI strip on top, sortable matrix below. Mirrors the
// personas-web `KnowledgeDenseTable` reference: one row per memory, every
// field rendered as a tabular numeric / chip cell, click-to-open detail
// panel slides in from the right (in-page, not modal). The whole surface
// is biased toward information density per pixel — minimal vertical
// padding, mono-font numerics, persistent column sort affordance.

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Sparkles, Plus, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';
import MemoryDetailModal from './MemoryDetailModal';
import { InlineAddMemoryForm } from './CreateMemoryForm';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES, formatRelativeTime } from '@/lib/utils/formatters';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import type { PersonaMemory } from '@/lib/types/types';
import { DebtText, debtText } from '@/i18n/DebtText';


type SortField = 'title' | 'persona' | 'category' | 'importance' | 'access_count' | 'last_accessed' | 'created' | 'tier';
type SortDir = 'asc' | 'desc';

const COL_WIDTHS = {
  type: 'w-10',
  title: 'flex-1 min-w-[180px]',
  persona: 'w-32',
  importance: 'w-28',
  tier: 'w-20',
  access: 'w-16',
  lastSeen: 'w-20',
  created: 'w-20',
} as const;

const TIER_TONE: Record<string, string> = {
  core: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  active: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
  archive: 'bg-foreground/10 text-foreground border-foreground/15',
};

export default function MemoriesPageDense() {
  const personas = useAgentStore((s) => s.personas);
  const {
    memories, memoriesTotal, memoryStats, fetchMemories, deleteMemory, reviewMemories,
    memoryReviewRunning,
  } = useOverviewStore(useShallow((s) => ({
    memories: s.memories,
    memoriesTotal: s.memoriesTotal,
    memoryStats: s.memoryStats,
    fetchMemories: s.fetchMemories,
    deleteMemory: s.deleteMemory,
    reviewMemories: s.reviewMemories,
    memoryReviewRunning: s.memoryReviewRunning,
  })));

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [categoryFilters, setCategoryFilters] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<PersonaMemory | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const latestRef = useRef(0);

  useEffect(() => {
    const requestId = ++latestRef.current;
    const timer = setTimeout(() => {
      if (requestId !== latestRef.current) return;
      fetchMemories({ search: search || undefined, sort_column: 'created_at', sort_direction: 'desc' });
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchMemories, search]);

  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    return map;
  }, [personas]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  }, [sortField]);

  const toggleCategory = useCallback((cat: string) => {
    setCategoryFilters((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  const sortedMemories = useMemo(() => {
    const filtered = categoryFilters.size > 0
      ? memories.filter((m) => categoryFilters.has(m.category))
      : memories;
    const dir = sortDir === 'asc' ? 1 : -1;
    const copy = [...filtered];
    copy.sort((a, b) => {
      switch (sortField) {
        case 'title': return dir * a.title.localeCompare(b.title);
        case 'persona': return dir * (personaMap.get(a.persona_id)?.name ?? '').localeCompare(personaMap.get(b.persona_id)?.name ?? '');
        case 'category': return dir * a.category.localeCompare(b.category);
        case 'importance': return dir * (a.importance - b.importance);
        case 'access_count': return dir * (a.access_count - b.access_count);
        case 'last_accessed': return dir * ((new Date(a.last_accessed_at ?? a.updated_at).getTime()) - (new Date(b.last_accessed_at ?? b.updated_at).getTime()));
        case 'created': return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        case 'tier': return dir * a.tier.localeCompare(b.tier);
        default: return 0;
      }
    });
    return copy;
  }, [memories, sortField, sortDir, categoryFilters, personaMap]);

  const stats = useMemo(() => {
    if (!memoryStats) return null;
    const tierCounts = memories.reduce<Record<string, number>>((acc, m) => {
      acc[m.tier] = (acc[m.tier] ?? 0) + 1; return acc;
    }, {});
    const totalAccess = memories.reduce((sum, m) => sum + m.access_count, 0);
    return {
      total: memoryStats.total,
      avgImportance: memoryStats.avg_importance,
      core: tierCounts.core ?? 0,
      active: tierCounts.active ?? 0,
      archive: tierCounts.archive ?? 0,
      totalAccess,
    };
  }, [memoryStats, memories]);

  const handleReview = useCallback(() => {
    void reviewMemories(undefined).catch(() => {});
  }, [reviewMemories]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Brain className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Memories"
        subtitle={`${memoriesTotal} memor${memoriesTotal !== 1 ? 'ies' : 'y'} stored by agents`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleReview} disabled={memoryReviewRunning || memoriesTotal === 0} className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-modal border transition-all bg-cyan-500/15 text-cyan-300 border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">
              {memoryReviewRunning ? <LoadingSpinner size="sm" /> : <Sparkles className="w-3.5 h-3.5" />}
              {memoryReviewRunning ? 'Reviewing...' : 'Review'}
            </button>
            <button onClick={() => setShowAddForm((v) => !v)} className={`flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-modal border transition-all ${showAddForm ? 'bg-violet-500/30 text-violet-200 border-violet-500/40' : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'}`}>
              <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
              Add
            </button>
          </div>
        }
      />

      {showAddForm && <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />}

      <ContentBody flex>
        {/* Numeric KPI strip — borrows the personas-web "TopMetric | Divider" pattern */}
        <div className="flex items-center gap-3 flex-wrap px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/5 flex-shrink-0">
          {stats && (
            <div className="flex items-center gap-3 typo-body flex-wrap">
              <KpiMetric label="Total" value={stats.total} />
              <KpiDivider />
              <KpiMetric label="Avg Importance" value={stats.avgImportance.toFixed(1)} tone="text-amber-300" />
              <KpiDivider />
              <KpiMetric label="Core" value={stats.core} tone="text-amber-300" />
              <KpiDivider />
              <KpiMetric label="Active" value={stats.active} tone="text-cyan-300" />
              <KpiDivider />
              <KpiMetric label="Archive" value={stats.archive} tone="text-foreground" />
              <KpiDivider />
              <KpiMetric label="Total Access" value={stats.totalAccess.toLocaleString()} tone="text-emerald-300" />
            </div>
          )}

          <div className="flex-1" />

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={debtText("auto_filter_ac323104")}
              className="w-44 pl-8 pr-2.5 py-1.5 typo-body rounded-card bg-secondary/30 border border-primary/10 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/30"
            />
          </div>
        </div>

        {/* Category pill bar — toggle filters */}
        <div className="flex items-center gap-1.5 flex-wrap px-4 md:px-6 py-2 border-b border-primary/10 flex-shrink-0">
          <span className="typo-label text-foreground mr-1">Category</span>
          {ALL_MEMORY_CATEGORIES.map((cat) => {
            const colors = MEMORY_CATEGORY_COLORS[cat]!;
            const active = categoryFilters.has(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 typo-body font-medium transition-all border ${
                  active
                    ? `${colors.bg} ${colors.text} border-current/30`
                    : 'text-foreground hover:text-foreground hover:bg-secondary/30 border-transparent'
                }`}
              >
                {colors.label}
              </button>
            );
          })}
          {categoryFilters.size > 0 && (
            <button onClick={() => setCategoryFilters(new Set())} className="typo-body text-foreground hover:text-foreground px-2 py-1">
              Clear
            </button>
          )}
        </div>

        {/* Dense matrix */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in srgb, var(--primary) 4%, transparent), transparent 70%)' }} />

          {/* Column headers */}
          <div className="flex items-center border-b border-primary/10 bg-background/80 flex-shrink-0 relative z-10">
            <div className={`${COL_WIDTHS.type} flex justify-center px-2 py-2 typo-label text-foreground`}>TYPE</div>
            <SortHeader field="title" label="Title" width={COL_WIDTHS.title} sortField={sortField} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortHeader field="persona" label="Persona" width={COL_WIDTHS.persona} sortField={sortField} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortHeader field="importance" label="Importance" width={COL_WIDTHS.importance} sortField={sortField} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortHeader field="tier" label="Tier" width={COL_WIDTHS.tier} sortField={sortField} sortDir={sortDir} onSort={handleSort} align="left" />
            <SortHeader field="access_count" label="Hits" width={COL_WIDTHS.access} sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right" />
            <SortHeader field="last_accessed" label="Last seen" width={COL_WIDTHS.lastSeen} sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right" />
            <SortHeader field="created" label="Created" width={COL_WIDTHS.created} sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right" />
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto relative z-10">
            {sortedMemories.length === 0 ? (
              <div className="flex items-center justify-center py-12 typo-body text-foreground"><DebtText k="auto_no_memories_match_current_filters_06cb075f" /></div>
            ) : (
              <AnimatePresence mode="popLayout">
                {sortedMemories.map((memory, i) => (
                  <DenseRow
                    key={memory.id}
                    memory={memory}
                    index={i}
                    personaName={personaMap.get(memory.persona_id)?.name ?? 'Unknown'}
                    personaColor={personaMap.get(memory.persona_id)?.color ?? '#6b7280'}
                    isSelected={selected?.id === memory.id}
                    onSelect={() => setSelected((prev) => (prev?.id === memory.id ? null : memory))}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </ContentBody>

      {selected && (
        <MemoryDetailModal
          memory={selected}
          personaName={personaMap.get(selected.persona_id)?.name ?? 'Unknown'}
          personaColor={personaMap.get(selected.persona_id)?.color ?? '#6B7280'}
          onClose={() => setSelected(null)}
          onDelete={() => { deleteMemory(selected.id); setSelected(null); }}
        />
      )}
    </ContentBox>
  );
}

// -- Cells & helpers -------------------------------------------------------

function DenseRow({
  memory, index, personaName, personaColor, isSelected, onSelect,
}: {
  memory: PersonaMemory; index: number; personaName: string; personaColor: string; isSelected: boolean; onSelect: () => void;
}) {
  const lastSeen = memory.last_accessed_at ?? memory.updated_at;
  const importancePct = (memory.importance / 5) * 100;
  const importanceColor = memory.importance >= 4 ? '#fb7185' : memory.importance >= 3 ? '#fbbf24' : '#34d399';
  const tierClass = TIER_TONE[memory.tier] ?? TIER_TONE.archive!;

  return (
    <motion.button
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onSelect}
      className={`group flex items-center w-full text-left transition-all duration-150 border-b border-primary/5 ${
        index % 2 === 0 ? 'bg-transparent' : 'bg-secondary/[0.03]'
      } ${isSelected ? 'bg-primary/[0.08] ring-1 ring-primary/25 ring-inset' : 'hover:bg-secondary/[0.06]'}`}
    >
      <div className={`${COL_WIDTHS.type} flex justify-center px-2 py-2`}>
        <CategoryChip category={memory.category} className="!px-1.5" label="" />
      </div>
      <div className={`${COL_WIDTHS.title} px-2 py-2 min-w-0`}>
        <p className="typo-body font-medium text-foreground truncate">{stripHtml(memory.title)}</p>
      </div>
      <div className={`${COL_WIDTHS.persona} px-2 py-2 flex items-center gap-1.5 min-w-0`}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: personaColor }} />
        <span className="typo-body text-foreground truncate">{personaName}</span>
      </div>
      <div className={`${COL_WIDTHS.importance} px-2 py-2`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${importancePct}%`, backgroundColor: importanceColor }} />
          </div>
          <span className="typo-code font-mono tabular-nums text-foreground w-7 text-right">{memory.importance}/5</span>
        </div>
      </div>
      <div className={`${COL_WIDTHS.tier} px-2 py-2`}>
        <span className={`inline-flex items-center px-1.5 py-0.5 typo-caption font-medium rounded-input border ${tierClass}`}>
          {memory.tier}
        </span>
      </div>
      <div className={`${COL_WIDTHS.access} px-2 py-2 text-right`}>
        <span className="typo-code font-mono tabular-nums text-emerald-300">{memory.access_count}</span>
      </div>
      <div className={`${COL_WIDTHS.lastSeen} px-2 py-2 text-right`}>
        <span className="typo-code font-mono tabular-nums text-foreground">{formatRelativeTime(lastSeen).replace(/ ago$/, '')}</span>
      </div>
      <div className={`${COL_WIDTHS.created} px-2 py-2 text-right`}>
        <span className="typo-code font-mono tabular-nums text-foreground">{formatRelativeTime(memory.created_at).replace(/ ago$/, '')}</span>
      </div>
    </motion.button>
  );
}

function SortHeader({
  field, label, width, sortField, sortDir, onSort, align,
}: {
  field: SortField; label: string; width: string; sortField: SortField; sortDir: SortDir; onSort: (f: SortField) => void; align: 'left' | 'right';
}) {
  const active = sortField === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={`${width} flex items-center gap-1 px-2 py-2 typo-label transition-colors ${align === 'right' ? 'justify-end' : 'justify-start'} ${active ? 'text-foreground' : 'text-foreground hover:text-foreground/80'}`}
    >
      {label}
      <span className="flex flex-col -space-y-0.5">
        <ChevronUp className={`h-2.5 w-2.5 ${active && sortDir === 'asc' ? 'text-primary' : 'text-foreground'}`} />
        <ChevronDown className={`h-2.5 w-2.5 ${active && sortDir === 'desc' ? 'text-primary' : 'text-foreground'}`} />
      </span>
    </button>
  );
}

function KpiMetric({ label, value, tone = 'text-foreground' }: { label: string; value: string | number; tone?: string }) {
  return (
    <span className="typo-body text-foreground whitespace-nowrap">
      {label} <span className={`${tone} font-bold tabular-nums typo-data`}>{value}</span>
    </span>
  );
}

function KpiDivider() {
  return <span className="text-foreground">|</span>;
}
