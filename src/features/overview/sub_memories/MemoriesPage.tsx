import { useEffect, useState, useMemo, useCallback } from 'react';
import { Brain, Search, Trash2, Bot, X, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import type { DbPersonaMemory } from '@/lib/types/types';
import type { PersonaMemoryCategory } from '@/lib/types/frontendTypes';
import { formatRelativeTime, MEMORY_CATEGORY_COLORS } from '@/lib/utils/formatters';

const ALL_CATEGORIES: PersonaMemoryCategory[] = ['fact', 'preference', 'instruction', 'context', 'learned', 'custom'];

type SortColumn = 'importance' | 'created_at';
type SortDirection = 'asc' | 'desc';
interface SortState { column: SortColumn; direction: SortDirection }

function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try { return JSON.parse(tagsJson); } catch { return []; }
}

// ── Importance dots ──────────────────────────────────────────────
function ImportanceDots({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i <= value ? 'bg-amber-400' : 'bg-muted-foreground/15'
          }`}
        />
      ))}
    </div>
  );
}

// ── Memory Row ───────────────────────────────────────────────────
function MemoryRow({
  memory,
  personaName,
  personaColor,
  onDelete,
}: {
  memory: DbPersonaMemory;
  personaName: string;
  personaColor: string;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
  const cat = MEMORY_CATEGORY_COLORS[memory.category] ?? defaultCat;
  const tags = parseTags(memory.tags);

  const agentAvatar = (
    <div
      className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
      style={{ background: `linear-gradient(135deg, ${personaColor}20, ${personaColor}40)`, border: `1px solid ${personaColor}50` }}
    >
      <Bot className="w-3 h-3" style={{ color: personaColor }} />
    </div>
  );

  const categoryBadge = (
    <span className={`inline-flex px-2 py-0.5 text-[10px] font-mono uppercase rounded-md border flex-shrink-0 ${cat.bg} ${cat.text} ${cat.border}`}>
      {cat.label}
    </span>
  );

  const deleteButton = (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {confirmDelete ? (
        <button onClick={onDelete} className="text-[10px] text-red-400 hover:text-red-300">
          Sure?
        </button>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="border-b border-primary/5 hover:bg-secondary/20 transition-colors"
    >
      {/* Desktop table row (md+) */}
      <div className="hidden md:flex items-center gap-4 px-6 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="w-[140px] flex items-center gap-2 flex-shrink-0">
          {agentAvatar}
          <span className="text-xs text-foreground/70 truncate">{personaName}</span>
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground/80 truncate block">{memory.title}</span>
        </div>

        {categoryBadge}

        <div className="w-[60px] flex-shrink-0">
          <ImportanceDots value={memory.importance} />
        </div>

        <div className="w-[120px] flex items-center gap-1 flex-shrink-0 overflow-hidden">
          {tags.slice(0, 2).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10 truncate max-w-[55px]">
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[9px] text-muted-foreground/30">+{tags.length - 2}</span>
          )}
        </div>

        <span className="text-xs text-muted-foreground/40 w-[60px] text-right flex-shrink-0">
          {formatRelativeTime(memory.created_at)}
        </span>

        <div className="w-[32px] flex-shrink-0">
          {deleteButton}
        </div>

        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Mobile card layout (<md) */}
      <div className="flex md:hidden flex-col gap-2 px-4 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {agentAvatar}
            <span className="text-xs text-foreground/70 truncate">{personaName}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {deleteButton}
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        <span className="text-sm text-foreground/80 line-clamp-2">{memory.title}</span>

        <div className="flex items-center gap-2 flex-wrap">
          {categoryBadge}
          <ImportanceDots value={memory.importance} />
          {tags.slice(0, 2).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10 truncate max-w-[80px]">
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[9px] text-muted-foreground/30">+{tags.length - 2}</span>
          )}
          <span className="text-[10px] text-muted-foreground/40 ml-auto">
            {formatRelativeTime(memory.created_at)}
          </span>
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 md:px-6 md:pl-[172px]">
              <p className="text-sm text-foreground/60 leading-relaxed whitespace-pre-wrap">
                {memory.content}
              </p>
              {tags.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  <Tag className="w-3 h-3 text-muted-foreground/30" />
                  {tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 text-[10px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {memory.source_execution_id && (
                <div className="mt-2 text-[10px] font-mono text-muted-foreground/25">
                  Source: {memory.source_execution_id}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

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

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch on filter change (search is applied client-side only)
  useEffect(() => {
    fetchMemories({
      persona_id: selectedPersonaId || undefined,
      category: selectedCategory || undefined,
    });
  }, [fetchMemories, selectedPersonaId, selectedCategory]);

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

  // Client-side search filtering (backend filters by persona/category only)
  const filteredMemories = useMemo(() => {
    if (!debouncedSearch) return memories;
    const q = debouncedSearch.toLowerCase();
    return memories.filter(
      (m) => m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q),
    );
  }, [memories, debouncedSearch]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-secondary/50 border border-primary/15 rounded-lg outline-none focus:border-primary/30 text-foreground/80 placeholder:text-muted-foreground/30"
            />
          </div>

          {/* Persona filter */}
          <select
            value={selectedPersonaId || ''}
            onChange={(e) => setSelectedPersonaId(e.target.value || null)}
            className="px-3 py-2 text-xs bg-secondary/50 border border-primary/15 rounded-lg outline-none text-foreground/70 appearance-none cursor-pointer min-w-[130px]"
          >
            <option value="">All agents</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Category filter */}
          <select
            value={selectedCategory || ''}
            onChange={(e) => setSelectedCategory(e.target.value || null)}
            className="px-3 py-2 text-xs bg-secondary/50 border border-primary/15 rounded-lg outline-none text-foreground/70 appearance-none cursor-pointer min-w-[110px]"
          >
            <option value="">All categories</option>
            {ALL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{MEMORY_CATEGORY_COLORS[cat]?.label ?? cat}</option>
            ))}
          </select>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2.5 py-2 text-xs text-muted-foreground/50 hover:text-foreground/70 rounded-lg hover:bg-secondary/40 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/40">
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
              <span className="w-[140px] text-[10px] font-mono uppercase text-muted-foreground/40 flex-shrink-0">Agent</span>
              <span className="flex-1 text-[10px] font-mono uppercase text-muted-foreground/40">Title</span>
              <span className="w-[70px] text-[10px] font-mono uppercase text-muted-foreground/40 flex-shrink-0">Category</span>
              <button
                onClick={() => toggleSort('importance')}
                className={`w-[60px] flex items-center gap-0.5 text-[10px] font-mono uppercase flex-shrink-0 transition-colors ${sort.column === 'importance' ? 'text-foreground/70' : 'text-muted-foreground/40 hover:text-muted-foreground/60'}`}
              >
                Priority
                {sort.column === 'importance' ? (
                  sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3 opacity-30" />
                )}
              </button>
              <span className="w-[120px] text-[10px] font-mono uppercase text-muted-foreground/40 flex-shrink-0">Tags</span>
              <button
                onClick={() => toggleSort('created_at')}
                className={`w-[60px] flex items-center justify-end gap-0.5 text-[10px] font-mono uppercase flex-shrink-0 transition-colors ${sort.column === 'created_at' ? 'text-foreground/70' : 'text-muted-foreground/40 hover:text-muted-foreground/60'}`}
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
