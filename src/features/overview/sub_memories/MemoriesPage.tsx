import { useEffect, useState, useMemo, useCallback } from 'react';
import { Brain, Bot, Plus, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES } from '@/lib/utils/formatters';
import { MemoryRow } from '@/features/overview/sub_memories/MemoryCard';
import { InlineAddMemoryForm } from '@/features/overview/sub_memories/CreateMemoryForm';
import { MemoryFilterBar } from '@/features/overview/sub_memories/MemoryFilterBar';

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

  const [search, setSearch] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ column: 'created_at', direction: 'desc' });
  const [showAddForm, setShowAddForm] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch on filter change (search is server-side)
  useEffect(() => {
    fetchMemories({
      persona_id: selectedPersonaId || undefined,
      category: selectedCategory || undefined,
      search: debouncedSearch || undefined,
    });
  }, [fetchMemories, selectedPersonaId, selectedCategory, debouncedSearch]);

  // Build persona lookup
  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) {
      map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    }
    return map;
  }, [personas]);

  const hasFilters = !!selectedPersonaId || !!selectedCategory || !!debouncedSearch;

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

  // ── Stats computation ──────────────────────────────────────────
  const memoryStats = useMemo(() => {
    const total = filteredMemories.length;
    const categoryCounts = new Map<string, number>();
    const agentCounts = new Map<string, number>();
    let importanceSum = 0;

    for (const m of filteredMemories) {
      categoryCounts.set(m.category, (categoryCounts.get(m.category) || 0) + 1);
      agentCounts.set(m.persona_id, (agentCounts.get(m.persona_id) || 0) + 1);
      importanceSum += m.importance;
    }

    const avgImportance = total > 0 ? (importanceSum / total) : 0;

    // Top agent
    let topAgentId: string | null = null;
    let topAgentCount = 0;
    for (const [pid, count] of agentCounts) {
      if (count > topAgentCount) {
        topAgentId = pid;
        topAgentCount = count;
      }
    }
    const topAgent = topAgentId ? personaMap.get(topAgentId) : null;

    // Category segments for stacked bar
    const categoryHexColors: Record<string, string> = {
      fact: '#3b82f6', preference: '#f59e0b', instruction: '#8b5cf6',
      context: '#10b981', learned: '#06b6d4', custom: '#6b7280',
    };
    const segments = ALL_MEMORY_CATEGORIES
      .filter((cat) => (categoryCounts.get(cat) || 0) > 0)
      .map((cat) => ({
        category: cat,
        count: categoryCounts.get(cat) || 0,
        pct: total > 0 ? ((categoryCounts.get(cat) || 0) / total) * 100 : 0,
        color: categoryHexColors[cat] || '#6b7280',
        label: MEMORY_CATEGORY_COLORS[cat]?.label ?? cat,
      }));

    return { total, avgImportance, topAgent, topAgentId, topAgentCount, segments };
  }, [filteredMemories, personaMap]);

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-6 py-5 border-b border-primary/10 bg-primary/5 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Brain className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground/90">Agent Memories</h1>
              <p className="text-xs text-muted-foreground/50">
                {memoriesTotal} memor{memoriesTotal !== 1 ? 'ies' : 'y'} stored by agents
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
              showAddForm
                ? 'bg-violet-500/30 text-violet-200 border-violet-500/40'
                : 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'
            }`}
          >
            <Plus className={`w-3.5 h-3.5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
            Add Memory
          </button>
        </div>

        {/* Filter bar */}
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

      {/* Inline Add Memory Form */}
      <AnimatePresence>
        {showAddForm && (
          <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />
        )}
      </AnimatePresence>

      {/* Stats Bar — always visible to show total knowledge base size */}
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 bg-secondary/20 flex-shrink-0">
        <div className="flex items-center gap-6 flex-wrap">
          {/* Total knowledge base count (global, not filtered) */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Brain className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div className="flex flex-col">
              <AnimatePresence mode="wait">
                <motion.span
                  key={memoriesTotal}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  className="font-bold text-lg text-violet-400"
                >
                  {memoriesTotal}
                </motion.span>
              </AnimatePresence>
              <span className="text-[9px] text-muted-foreground/30 -mt-1">total memories</span>
            </div>
          </div>

          {/* Category stacked bar — only when there are memories */}
          {memoryStats.total > 0 && (
            <div className="flex-1 min-w-[120px] max-w-xs">
              <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-secondary/40">
                {memoryStats.segments.map((seg) => (
                  <div
                    key={seg.category}
                    className="h-full transition-all duration-300"
                    style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
                    title={`${seg.label}: ${seg.count}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                {memoryStats.segments.map((seg) => (
                  <div key={seg.category} className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
                    <span className="text-[9px] text-muted-foreground/40">{seg.label} {seg.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top agent */}
          {memoryStats.topAgent && (
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${memoryStats.topAgent.color}20, ${memoryStats.topAgent.color}40)`,
                  border: `1px solid ${memoryStats.topAgent.color}50`,
                }}
              >
                <Bot className="w-3.5 h-3.5" style={{ color: memoryStats.topAgent.color }} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-foreground/70 truncate max-w-[80px]">{memoryStats.topAgent.name}</span>
                <span className="text-[9px] text-muted-foreground/30 -mt-0.5">{memoryStats.topAgentCount} memories</span>
              </div>
            </div>
          )}

          {/* Avg importance */}
          {memoryStats.total > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Star className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="flex flex-col">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={memoryStats.avgImportance.toFixed(1)}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="font-bold text-lg text-amber-400"
                  >
                    {memoryStats.avgImportance.toFixed(1)}
                  </motion.span>
                </AnimatePresence>
                <span className="text-[9px] text-muted-foreground/30 -mt-1">avg importance</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="px-4 md:px-6 py-2 text-[11px] font-mono text-muted-foreground/40 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
          Showing {sortedMemories.length} of {memoriesTotal} memories
        </div>

        {filteredMemories.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground/40">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
              <Brain className="w-8 h-8 text-violet-400/40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">No memories yet</p>
              <p className="text-xs text-muted-foreground/30 mt-1 max-w-xs">
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
              <span className="w-[140px] text-[11px] font-mono uppercase text-muted-foreground/40 flex-shrink-0">Agent</span>
              <span className="flex-1 text-[11px] font-mono uppercase text-muted-foreground/40">Title</span>
              <span className="w-[70px] text-[11px] font-mono uppercase text-muted-foreground/40 flex-shrink-0">Category</span>
              <button
                onClick={() => toggleSort('importance')}
                className={`w-[60px] flex items-center gap-0.5 text-[11px] font-mono uppercase flex-shrink-0 transition-colors ${sort.column === 'importance' ? 'text-foreground/70' : 'text-muted-foreground/40 hover:text-muted-foreground/60'}`}
              >
                Priority
                {sort.column === 'importance' ? (
                  sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3 opacity-30" />
                )}
              </button>
              <span className="w-[120px] text-[11px] font-mono uppercase text-muted-foreground/40 flex-shrink-0">Tags</span>
              <button
                onClick={() => toggleSort('created_at')}
                className={`w-[60px] flex items-center justify-end gap-0.5 text-[11px] font-mono uppercase flex-shrink-0 transition-colors ${sort.column === 'created_at' ? 'text-foreground/70' : 'text-muted-foreground/40 hover:text-muted-foreground/60'}`}
              >
                Created
                {sort.column === 'created_at' ? (
                  sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3 opacity-30" />
                )}
              </button>
              <span className="w-[32px] flex-shrink-0" />
              <span className="w-[14px] flex-shrink-0" />
            </div>

            {/* Rows */}
            <AnimatePresence>
              {sortedMemories.map((memory) => {
                const persona = personaMap.get(memory.persona_id);
                return (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    personaName={persona?.name || 'Unknown'}
                    personaColor={persona?.color || '#6B7280'}
                    onDelete={() => deleteMemory(memory.id)}
                  />
                );
              })}
            </AnimatePresence>
          </>
        )}
      </div>

    </div>
  );
}
