import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Brain, Search, Trash2, Bot, X, Tag, ChevronDown, ChevronUp, Plus, Star } from 'lucide-react';
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
  const label = `Importance: ${value} of 5`;
  return (
    <div className="flex items-center gap-1" title={label} aria-label={label}>
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
      <span className="text-[9px] text-muted-foreground/40">({value}/5)</span>
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
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
  const cat = MEMORY_CATEGORY_COLORS[memory.category] ?? defaultCat;
  const tags = parseTags(memory.tags);

  // Auto-revert confirm state after 3 seconds
  useEffect(() => {
    if (!confirmDelete) return;
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
    return () => { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current); };
  }, [confirmDelete]);

  const agentAvatar = (
    <div
      className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
      style={{ background: `linear-gradient(135deg, ${personaColor}20, ${personaColor}40)`, border: `1px solid ${personaColor}50` }}
    >
      <Bot className="w-3 h-3" style={{ color: personaColor }} />
    </div>
  );

  const categoryBadge = (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-mono uppercase rounded-md border flex-shrink-0 ${cat.bg} ${cat.text} ${cat.border}`}>
      {cat.label}
    </span>
  );

  const deleteButton = (
    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <AnimatePresence mode="wait">
        {confirmDelete ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-1"
          >
            <button
              onClick={onDelete}
              className="px-2 py-1 text-[10px] font-medium rounded-md bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 text-[10px] font-medium rounded-md bg-secondary/50 text-foreground/60 hover:text-foreground/80 hover:bg-secondary/70 transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="trash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirmDelete(true)}
            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="border-b border-primary/10 hover:bg-secondary/20 transition-colors"
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
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10 truncate max-w-[55px]">
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground/30">+{tags.length - 2}</span>
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
            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-secondary/40 text-muted-foreground/50 rounded border border-primary/10 truncate max-w-[80px]">
              {tag}
            </span>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground/30">+{tags.length - 2}</span>
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

// ── Interactive Importance Dots (clickable) ─────────────────────
function InteractiveImportanceDots({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const display = hovered ?? value;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHovered(i)}
            onClick={() => onChange(i)}
            className="group/dot p-0.5 rounded-full transition-transform hover:scale-125 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50"
            aria-label={`Set importance to ${i}`}
          >
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i <= display ? 'bg-amber-400' : 'bg-muted-foreground/15 group-hover/dot:bg-amber-400/30'
              }`}
            />
          </button>
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground/50 tabular-nums min-w-[24px]">({display}/5)</span>
    </div>
  );
}

// ── Inline Add Memory Form ──────────────────────────────────────
function InlineAddMemoryForm({ onClose }: { onClose: () => void }) {
  const personas = usePersonaStore((s) => s.personas);
  const createMemory = usePersonaStore((s) => s.createMemory);

  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<PersonaMemoryCategory>('fact');
  const [importance, setImportance] = useState(3);
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = personaId && title.trim() && content.trim();

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    await createMemory({ persona_id: personaId, title: title.trim(), content: content.trim(), category, importance, tags });
    setSaving(false);
    onClose();
  }, [canSave, personaId, title, content, category, importance, tagsInput, createMemory, onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', damping: 24, stiffness: 300 }}
      className="mx-4 md:mx-6 mb-1 mt-4 p-5 rounded-2xl bg-secondary/40 backdrop-blur-sm border border-violet-500/20"
    >
      <div className="space-y-4">
        {/* Row 1: Agent + Category side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-mono uppercase text-muted-foreground/50 mb-1.5 block">Agent</label>
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-lg outline-none focus:border-violet-500/40 text-foreground/80 appearance-none cursor-pointer"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-mono uppercase text-muted-foreground/50 mb-1.5 block">Category</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ALL_CATEGORIES.map((cat) => {
                const defaultColors = { label: cat, bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' };
                const colors = MEMORY_CATEGORY_COLORS[cat] ?? defaultColors;
                const isActive = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-2 py-1 text-[10px] font-mono uppercase rounded-md border transition-all ${
                      isActive
                        ? `${colors.bg} ${colors.text} ${colors.border} ring-1 ring-offset-1 ring-offset-background ${colors.border.replace('border-', 'ring-')}`
                        : 'bg-secondary/40 text-muted-foreground/40 border-primary/10 hover:text-muted-foreground/60 hover:border-primary/20'
                    }`}
                  >
                    {colors.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Row 2: Title */}
        <div>
          <label className="text-[11px] font-mono uppercase text-muted-foreground/50 mb-1.5 block">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Always use metric units"
            className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-lg outline-none focus:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/30"
            autoFocus
          />
        </div>

        {/* Row 3: Content */}
        <div>
          <label className="text-[11px] font-mono uppercase text-muted-foreground/50 mb-1.5 block">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Describe what the agent should remember..."
            rows={3}
            className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-lg outline-none focus:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/30 resize-none"
          />
        </div>

        {/* Row 4: Importance + Tags side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-mono uppercase text-muted-foreground/50 mb-1.5 block">Importance</label>
            <InteractiveImportanceDots value={importance} onChange={setImportance} />
          </div>

          <div>
            <label className="text-[11px] font-mono uppercase text-muted-foreground/50 mb-1.5 block">
              Tags <span className="normal-case text-muted-foreground/30">(comma-separated)</span>
            </label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. units, formatting, output"
              className="w-full px-3 py-2 text-sm bg-background/60 border border-primary/15 rounded-lg outline-none focus:border-violet-500/40 text-foreground/80 placeholder:text-muted-foreground/30"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {saving ? 'Saving...' : 'Save Memory'}
          </button>
        </div>
      </div>
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
  const [showAddForm, setShowAddForm] = useState(false);

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
    const segments = ALL_CATEGORIES
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

          {/* Category filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`relative px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                selectedCategory === null
                  ? 'bg-foreground/10 text-foreground/80 border-foreground/20'
                  : 'bg-secondary/40 text-muted-foreground/50 border-primary/10 hover:text-muted-foreground/70'
              }`}
            >
              {selectedCategory === null && (
                <motion.div
                  layoutId="category-chip-active"
                  className="absolute inset-0 rounded-lg bg-foreground/10 border border-foreground/20"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span className="relative">All</span>
            </button>
            {ALL_CATEGORIES.map((cat) => {
              const defaultColors = { label: cat, bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' };
              const colors = MEMORY_CATEGORY_COLORS[cat] ?? defaultColors;
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(isActive ? null : cat)}
                  className={`relative flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                    isActive
                      ? `${colors.bg} ${colors.text} ${colors.border}`
                      : 'bg-secondary/40 text-muted-foreground/50 border-primary/10 hover:text-muted-foreground/70'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="category-chip-active"
                      className={`absolute inset-0 rounded-lg ${colors.bg} border ${colors.border}`}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                    />
                  )}
                  <span className={`relative w-2 h-2 rounded-full ${isActive ? colors.text.replace('text-', 'bg-') : 'bg-muted-foreground/30'}`} />
                  <span className="relative">{colors.label}</span>
                </button>
              );
            })}
          </div>

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

      {/* Inline Add Memory Form */}
      <AnimatePresence>
        {showAddForm && (
          <InlineAddMemoryForm onClose={() => setShowAddForm(false)} />
        )}
      </AnimatePresence>

      {/* Stats Bar */}
      {memoryStats.total > 0 && (
        <div className="px-4 md:px-6 py-3 border-b border-primary/10 bg-secondary/20 flex-shrink-0">
          <div className="flex items-center gap-6 flex-wrap">
            {/* Total */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Brain className="w-3.5 h-3.5 text-violet-400" />
              </div>
              <div className="flex flex-col">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={memoryStats.total}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="font-bold text-lg text-violet-400"
                  >
                    {memoryStats.total}
                  </motion.span>
                </AnimatePresence>
                <span className="text-[9px] text-muted-foreground/30 -mt-1">memories</span>
              </div>
            </div>

            {/* Category stacked bar */}
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
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 md:px-6 py-2 text-[11px] font-mono text-muted-foreground/40 border-b border-primary/10 bg-secondary/10">
          Showing {sortedMemories.length} of {memoriesTotal} memories
        </div>

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
