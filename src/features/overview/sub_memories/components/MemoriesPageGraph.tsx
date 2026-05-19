// Graph — SVG cluster layout. Mirrors the personas-web `KnowledgeClusterGraph`
// reference: memories cluster by category (6 wedges), node size encodes
// importance, edges connect memories belonging to the same persona. Hover
// any node to highlight the persona's whole knowledge thread.
//
// Mental model: the dashboard becomes a constellation map of what the team
// has learned — categories as star groups, personas as constellation lines.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Sparkles, Plus, X, GitFork } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { InlineAddMemoryForm } from './CreateMemoryForm';
import { MEMORY_CATEGORY_COLORS, ALL_MEMORY_CATEGORIES, formatRelativeTime } from '@/lib/utils/formatters';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import type { PersonaMemory } from '@/lib/types/types';

// Hex colors per category — matches the chip palette but produces real
// hex values usable in SVG stroke/fill, not Tailwind classes.
const CATEGORY_HEX: Record<string, string> = {
  fact: '#3b82f6',
  preference: '#f59e0b',
  instruction: '#8b5cf6',
  context: '#10b981',
  learned: '#06b6d4',
  constraint: '#ef4444',
};

interface NodePosition { x: number; y: number; }

export default function MemoriesPageGraph() {
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });
  const [hovered, setHovered] = useState<PersonaMemory | null>(null);
  const [selected, setSelected] = useState<PersonaMemory | null>(null);
  const [activeCategory, setActiveCategory] = useState<'all' | string>('all');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    fetchMemories({ sort_column: 'created_at', sort_direction: 'desc' });
  }, [fetchMemories]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const personaMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of personas) map.set(p.id, { name: p.name, color: p.color || '#6B7280' });
    return map;
  }, [personas]);

  const filtered = useMemo(() => {
    if (activeCategory === 'all') return memories;
    return memories.filter((m) => m.category === activeCategory);
  }, [memories, activeCategory]);

  const nodePositions = useMemo(() => computeClusterPositions(filtered, dimensions.width, dimensions.height), [filtered, dimensions]);
  const edges = useMemo(() => computePersonaEdges(filtered), [filtered]);

  const highlightedIds = useMemo(() => {
    if (!hovered) return new Set<string>();
    return new Set(filtered.filter((m) => m.persona_id === hovered.persona_id).map((m) => m.id));
  }, [hovered, filtered]);

  const stats = useMemo(() => {
    const personasInGraph = new Set(memories.map((m) => m.persona_id)).size;
    const categories = new Set(memories.map((m) => m.category)).size;
    return { total: memoriesTotal, personas: personasInGraph, categories, avg: memoryStats?.avg_importance ?? 0 };
  }, [memories, memoriesTotal, memoryStats]);

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
        {/* Top stats + filter row */}
        <div className="flex items-center gap-3 flex-wrap px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/5 flex-shrink-0">
          <div className="flex items-center gap-3 text-sm flex-wrap mr-auto">
            <KpiMetric label="Nodes" value={stats.total} />
            <KpiDivider />
            <KpiMetric label="Personas" value={stats.personas} tone="text-cyan-300" />
            <KpiDivider />
            <KpiMetric label="Clusters" value={stats.categories} tone="text-violet-300" />
            <KpiDivider />
            <KpiMetric label="Avg Importance" value={stats.avg.toFixed(1)} tone="text-amber-300" />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterPill active={activeCategory === 'all'} onClick={() => { setActiveCategory('all'); setSelected(null); }}>All</FilterPill>
            {ALL_MEMORY_CATEGORIES.map((cat) => {
              const colors = MEMORY_CATEGORY_COLORS[cat]!;
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => { setActiveCategory(cat); setSelected(null); }}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 typo-body font-medium transition-all border ${
                    active
                      ? `${colors.bg} ${colors.text} border-current/30`
                      : 'text-foreground/50 hover:text-foreground hover:bg-secondary/30 border-transparent'
                  }`}
                >
                  {colors.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="relative flex-1 min-h-0 overflow-hidden"
          onMouseLeave={() => setHovered(null)}
        >
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, color-mix(in srgb, var(--primary) 5%, transparent), transparent 80%)' }} />

          {/* Category labels (only when "all") */}
          {activeCategory === 'all' && (
            <ClusterLabels width={dimensions.width} height={dimensions.height} />
          )}

          <svg width={dimensions.width} height={dimensions.height} className="absolute inset-0">
            {/* Edges */}
            {edges.map((edge) => {
              const from = nodePositions.get(edge.from);
              const to = nodePositions.get(edge.to);
              if (!from || !to) return null;
              const personaColor = personaMap.get(edge.persona_id)?.color ?? '#64748b';
              const isHovered = hovered != null && (hovered.id === edge.from || hovered.id === edge.to || hovered.persona_id === edge.persona_id);
              return (
                <motion.line
                  key={`${edge.from}-${edge.to}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={personaColor}
                  strokeWidth={isHovered ? 1.5 : 0.5}
                  opacity={hovered ? (isHovered ? 0.6 : 0.04) : 0.14}
                  strokeDasharray={isHovered ? 'none' : '4 4'}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6 }}
                />
              );
            })}

            {/* Nodes */}
            {filtered.map((memory) => {
              const pos = nodePositions.get(memory.id);
              if (!pos) return null;
              const isDimmed = hovered != null && !highlightedIds.has(memory.id);
              return (
                <GraphNode
                  key={memory.id}
                  memory={memory}
                  position={pos}
                  isSelected={selected?.id === memory.id}
                  isHighlighted={highlightedIds.has(memory.id)}
                  isDimmed={isDimmed}
                  onSelect={(m) => setSelected((prev) => (prev?.id === m.id ? null : m))}
                  onHover={setHovered}
                />
              );
            })}
          </svg>

          {/* Legends */}
          <PersonaLegend personas={personas} memories={memories} />
          <SizeLegend />

          {/* Detail panel (in-page, not modal) */}
          <AnimatePresence>
            {selected && (
              <DetailPanel
                key={selected.id}
                memory={selected}
                personaName={personaMap.get(selected.persona_id)?.name ?? 'Unknown'}
                onClose={() => setSelected(null)}
                onDelete={() => { deleteMemory(selected.id); setSelected(null); }}
              />
            )}
          </AnimatePresence>

          {filtered.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-3">
                <GitFork className="w-8 h-8 text-foreground/30" />
                <p className="typo-body text-foreground/50">No memories in this cluster</p>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}

// -- Layout & helpers ------------------------------------------------------

function computeClusterPositions(memories: PersonaMemory[], width: number, height: number): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.28;
  const groups = new Map<string, PersonaMemory[]>();

  for (const memory of memories) {
    if (!groups.has(memory.category)) groups.set(memory.category, []);
    groups.get(memory.category)!.push(memory);
  }

  const categoryAngles: Record<string, number> = {};
  ALL_MEMORY_CATEGORIES.forEach((cat, i) => {
    categoryAngles[cat] = (i / ALL_MEMORY_CATEGORIES.length) * 360;
  });

  for (const [category, members] of groups) {
    const angleDeg = categoryAngles[category] ?? 0;
    const angle = (angleDeg * Math.PI) / 180;
    const clusterCx = cx + Math.cos(angle) * radius;
    const clusterCy = cy + Math.sin(angle) * radius;
    const spreadRadius = 24 + Math.sqrt(members.length) * 18;

    members.forEach((memory, index) => {
      const memberAngle = (index / Math.max(members.length, 1)) * Math.PI * 2;
      const dist = spreadRadius * (0.35 + (memory.importance / 5) * 0.65);
      positions.set(memory.id, {
        x: clusterCx + Math.cos(memberAngle) * dist,
        y: clusterCy + Math.sin(memberAngle) * dist,
      });
    });
  }

  return positions;
}

function computePersonaEdges(memories: PersonaMemory[]): { from: string; to: string; persona_id: string }[] {
  const edges: { from: string; to: string; persona_id: string }[] = [];
  const byPersona = new Map<string, PersonaMemory[]>();
  for (const m of memories) {
    if (!byPersona.has(m.persona_id)) byPersona.set(m.persona_id, []);
    byPersona.get(m.persona_id)!.push(m);
  }
  for (const [persona_id, members] of byPersona) {
    // Connect each member to the next (chain), not full mesh — keeps edge
    // count linear in N rather than quadratic for large persona libraries.
    for (let i = 0; i < members.length - 1; i++) {
      edges.push({ from: members[i]!.id, to: members[i + 1]!.id, persona_id });
    }
  }
  return edges;
}

// -- Components ------------------------------------------------------------

function GraphNode({
  memory, position, isSelected, isHighlighted, isDimmed, onSelect, onHover,
}: {
  memory: PersonaMemory; position: NodePosition; isSelected: boolean; isHighlighted: boolean; isDimmed: boolean;
  onSelect: (m: PersonaMemory) => void; onHover: (m: PersonaMemory) => void;
}) {
  const color = CATEGORY_HEX[memory.category] ?? '#64748b';
  const size = 12 + (memory.importance / 5) * 16;

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: isDimmed ? 0.25 : 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(memory)}
      onMouseEnter={() => onHover(memory)}
    >
      {(isSelected || isHighlighted) && (
        <circle cx={position.x} cy={position.y} r={size / 2 + 5} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />
      )}
      <circle
        cx={position.x}
        cy={position.y}
        r={size / 2}
        fill={`${color}25`}
        stroke={isSelected ? color : `${color}60`}
        strokeWidth={isSelected ? 2 : 1}
      />
      <circle cx={position.x} cy={position.y} r={2.5} fill={color} />
    </motion.g>
  );
}

function ClusterLabels({ width, height }: { width: number; height: number }) {
  const radius = Math.min(width, height) * 0.28 + 70;
  return (
    <>
      {ALL_MEMORY_CATEGORIES.map((cat, i) => {
        const colors = MEMORY_CATEGORY_COLORS[cat]!;
        const angleDeg = (i / ALL_MEMORY_CATEGORIES.length) * 360;
        const angle = (angleDeg * Math.PI) / 180;
        const lx = width / 2 + Math.cos(angle) * radius;
        const ly = height / 2 + Math.sin(angle) * radius;
        return (
          <div
            key={cat}
            className="absolute pointer-events-none"
            style={{ left: lx, top: ly, transform: 'translate(-50%, -50%)' }}
          >
            <span className={`typo-label ${colors.text} opacity-45`}>{colors.label}</span>
          </div>
        );
      })}
    </>
  );
}

function PersonaLegend({ personas, memories }: { personas: { id: string; name: string; color: string | null }[]; memories: PersonaMemory[] }) {
  const personasInGraph = useMemo(() => {
    const ids = new Set(memories.map((m) => m.persona_id));
    return personas.filter((p) => ids.has(p.id)).slice(0, 6);
  }, [personas, memories]);

  if (personasInGraph.length === 0) return null;

  return (
    <div className="absolute left-3 bottom-3 flex items-center gap-3 bg-background/80 backdrop-blur-sm rounded-card border border-primary/15 px-3 py-2">
      <span className="typo-label text-foreground/50">Personas</span>
      {personasInGraph.map((p) => (
        <div key={p.id} className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color ?? '#6B7280' }} />
          <span className="typo-caption text-foreground/70 truncate max-w-[100px]">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

function SizeLegend() {
  return (
    <div className="absolute left-3 top-3 flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-card border border-primary/15 px-3 py-2">
      <span className="typo-label text-foreground/50">Size</span>
      <span className="typo-caption text-foreground/60">Importance</span>
      <svg width={10} height={10}><circle cx={5} cy={5} r={3} fill="currentColor" className="text-foreground/30" /></svg>
      <span className="typo-caption text-foreground/60">low</span>
      <svg width={16} height={16}><circle cx={8} cy={8} r={6} fill="currentColor" className="text-foreground/30" /></svg>
      <span className="typo-caption text-foreground/60">high</span>
    </div>
  );
}

function DetailPanel({
  memory, personaName, onClose, onDelete,
}: {
  memory: PersonaMemory; personaName: string; onClose: () => void; onDelete: () => void;
}) {
  const color = CATEGORY_HEX[memory.category] ?? '#64748b';
  const lastSeen = memory.last_accessed_at ?? memory.updated_at;
  const colors = MEMORY_CATEGORY_COLORS[memory.category];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-3 top-3 z-50 w-80 rounded-modal border border-primary/20 bg-background/95 backdrop-blur-xl p-4 shadow-elevation-3"
    >
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className={`flex h-7 w-7 items-center justify-center rounded-input flex-shrink-0 ${colors?.bg ?? 'bg-foreground/10'}`}>
            <Brain className={`h-3.5 w-3.5 ${colors?.text ?? 'text-foreground/60'}`} />
          </div>
          <div className="min-w-0">
            <p className="typo-body font-semibold text-foreground leading-tight line-clamp-2">{stripHtml(memory.title)}</p>
            <p className="typo-caption text-foreground/60 mt-0.5">{personaName}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded-input hover:bg-secondary/40 text-foreground/60 flex-shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <DetailStat label="Importance" value={`${memory.importance}/5`} tone="text-amber-300" />
        <DetailStat label="Tier" value={memory.tier} tone="text-foreground" />
        <DetailStat label="Hits" value={memory.access_count} tone="text-emerald-300" />
      </div>

      <div className="h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden mb-3">
        <motion.div className="h-full rounded-full" style={{ backgroundColor: color }} initial={{ width: 0 }} animate={{ width: `${(memory.importance / 5) * 100}%` }} transition={{ duration: 0.4 }} />
      </div>

      <p className="typo-body text-foreground/70 line-clamp-4 mb-3">{stripHtml(memory.content)}</p>

      <div className="flex items-center justify-between typo-caption text-foreground/50 pt-2 border-t border-primary/10">
        <span>Last seen {formatRelativeTime(lastSeen)}</span>
        <button onClick={onDelete} className="text-red-400/80 hover:text-red-400">Delete</button>
      </div>
    </motion.div>
  );
}

function DetailStat({ label, value, tone = 'text-foreground' }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-input bg-secondary/40 px-2 py-1.5 text-center border border-primary/10">
      <p className="typo-label text-foreground/50">{label}</p>
      <p className={`typo-data font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full px-3 py-1 typo-body font-medium transition-all ${active ? 'bg-primary/15 text-foreground' : 'text-foreground/50 hover:text-foreground hover:bg-secondary/30'}`}>
      {children}
    </button>
  );
}

function KpiMetric({ label, value, tone = 'text-foreground' }: { label: string; value: string | number; tone?: string }) {
  return (
    <span className="typo-body text-foreground/50 whitespace-nowrap">
      {label} <span className={`${tone} font-bold tabular-nums typo-data`}>{value}</span>
    </span>
  );
}

function KpiDivider() {
  return <span className="text-foreground/10">|</span>;
}
