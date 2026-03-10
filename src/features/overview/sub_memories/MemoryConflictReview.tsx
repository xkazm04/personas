import { useState, useMemo, useCallback } from 'react';
import {
  AlertTriangle, Copy, GitMerge, ChevronDown,
  Check, Bot, ArrowRight, Shield, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { stripHtml } from '@/lib/utils/sanitizeHtml';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import {
  detectConflicts,
  type MemoryConflict,
  type ConflictKind,
  type ConflictResolution,
} from './memoryConflicts';

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

const KIND_CONFIG: Record<ConflictKind, { label: string; color: string; bg: string; border: string; icon: typeof Copy }> = {
  duplicate: { label: 'Duplicate', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Copy },
  contradiction: { label: 'Contradiction', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: AlertTriangle },
  superseded: { label: 'Superseded', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: ArrowRight },
};

function kindBadge(kind: ConflictKind) {
  const cfg = KIND_CONFIG[kind];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-lg border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function similarityBadge(sim: number) {
  const pct = Math.round(sim * 100);
  const color = pct >= 80 ? 'text-red-400' : pct >= 50 ? 'text-amber-400' : 'text-blue-400';
  return (
    <span className={`text-xs font-mono ${color}`}>{pct}%</span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface MemoryConflictReviewProps {
  onConflictsResolved?: () => void;
}

export function MemoryConflictReview({ onConflictsResolved }: MemoryConflictReviewProps) {
  const memories = usePersonaStore((s) => s.memories);
  const personas = usePersonaStore((s) => s.personas);
  const deleteMemory = usePersonaStore((s) => s.deleteMemory);
  const createMemory = usePersonaStore((s) => s.createMemory);
  const fetchMemories = usePersonaStore((s) => s.fetchMemories);

  const [expanded, setExpanded] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  const personaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) map.set(p.id, p.name);
    return map;
  }, [personas]);

  const conflicts = useMemo(() => detectConflicts(memories), [memories]);
  const unresolvedConflicts = useMemo(
    () => conflicts.filter((c) => !resolvedIds.has(c.id)),
    [conflicts, resolvedIds],
  );

  const handleResolve = useCallback(async (conflict: MemoryConflict, resolution: ConflictResolution) => {
    setProcessing(conflict.id);
    try {
      switch (resolution) {
        case 'keep_a':
          await deleteMemory(conflict.memoryB.id);
          break;
        case 'keep_b':
          await deleteMemory(conflict.memoryA.id);
          break;
        case 'merge': {
          // Create merged memory, delete both originals
          const merged = mergeMemories(conflict.memoryA, conflict.memoryB);
          const created = await createMemory(merged);
          if (created) {
            await deleteMemory(conflict.memoryA.id);
            await deleteMemory(conflict.memoryB.id);
          }
          break;
        }
        case 'dismiss':
          // Just mark as resolved, no data change
          break;
      }
      setResolvedIds((prev) => new Set(prev).add(conflict.id));
      if (activeConflictId === conflict.id) setActiveConflictId(null);
      if (resolution !== 'dismiss') {
        await fetchMemories();
      }
      useToastStore.getState().addToast(
        resolution === 'dismiss' ? 'Conflict dismissed' : 'Conflict resolved',
        'success',
      );
      onConflictsResolved?.();
    } catch {
      useToastStore.getState().addToast('Failed to resolve conflict', 'error');
    } finally {
      setProcessing(null);
    }
  }, [deleteMemory, createMemory, fetchMemories, activeConflictId, onConflictsResolved]);

  if (conflicts.length === 0) return null;

  const countByKind = {
    duplicate: unresolvedConflicts.filter((c) => c.kind === 'duplicate').length,
    contradiction: unresolvedConflicts.filter((c) => c.kind === 'contradiction').length,
    superseded: unresolvedConflicts.filter((c) => c.kind === 'superseded').length,
  };

  return (
    <div className="mx-4 md:mx-6">
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className={`w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all text-left cursor-pointer ${
          expanded
            ? 'bg-amber-500/8 border-amber-500/25'
            : 'bg-amber-500/5 border-amber-500/15 hover:border-amber-500/25 hover:bg-amber-500/10'
        }`}
      >
        <Shield className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground/85 flex-1">
          {unresolvedConflicts.length} conflict{unresolvedConflicts.length !== 1 ? 's' : ''} detected
        </span>

        {/* Kind counts */}
        <div className="flex items-center gap-1.5">
          {countByKind.contradiction > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium rounded-lg bg-red-500/15 text-red-400 border border-red-500/20">
              {countByKind.contradiction} contradiction{countByKind.contradiction !== 1 ? 's' : ''}
            </span>
          )}
          {countByKind.duplicate > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/20">
              {countByKind.duplicate} duplicate{countByKind.duplicate !== 1 ? 's' : ''}
            </span>
          )}
          {countByKind.superseded > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20">
              {countByKind.superseded} superseded
            </span>
          )}
        </div>

        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Conflict list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {unresolvedConflicts.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground/60">
                  <Check className="w-5 h-5 mx-auto mb-2 text-emerald-400" />
                  All conflicts resolved
                </div>
              ) : (
                unresolvedConflicts.map((conflict) => (
                  <ConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    personaMap={personaMap}
                    isActive={activeConflictId === conflict.id}
                    isProcessing={processing === conflict.id}
                    onToggle={() => setActiveConflictId(activeConflictId === conflict.id ? null : conflict.id)}
                    onResolve={(res) => void handleResolve(conflict, res)}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict card
// ---------------------------------------------------------------------------

function ConflictCard({
  conflict,
  personaMap,
  isActive,
  isProcessing,
  onToggle,
  onResolve,
}: {
  conflict: MemoryConflict;
  personaMap: Map<string, string>;
  isActive: boolean;
  isProcessing: boolean;
  onToggle: () => void;
  onResolve: (res: ConflictResolution) => void;
}) {
  const nameA = personaMap.get(conflict.memoryA.persona_id) ?? 'Unknown';
  const nameB = personaMap.get(conflict.memoryB.persona_id) ?? 'Unknown';

  return (
    <div className={`rounded-xl border transition-colors ${
      isActive ? 'border-primary/25 bg-secondary/30' : 'border-primary/10 bg-background/30'
    }`}>
      {/* Summary row */}
      <button
        type="button"
        onClick={onToggle}
        disabled={isProcessing}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer disabled:opacity-50"
      >
        {kindBadge(conflict.kind)}
        <span className="text-sm text-foreground/80 flex-1 truncate">
          {stripHtml(conflict.memoryA.title)}
          <span className="text-muted-foreground/40 mx-1.5">vs</span>
          {stripHtml(conflict.memoryB.title)}
        </span>
        {similarityBadge(conflict.similarity)}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform ${isActive ? 'rotate-180' : ''}`} />
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-primary/10 pt-3">
              {/* Reason */}
              <p className="text-xs text-muted-foreground/70">{conflict.reason}</p>

              {/* Side by side */}
              <div className="grid grid-cols-2 gap-2">
                <MemoryPreview
                  label="Memory A"
                  memory={conflict.memoryA}
                  agentName={nameA}
                  accent="blue"
                />
                <MemoryPreview
                  label="Memory B"
                  memory={conflict.memoryB}
                  agentName={nameB}
                  accent="amber"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {conflict.kind === 'duplicate' && (
                  <ResolutionButton
                    icon={GitMerge}
                    label="Merge"
                    variant="primary"
                    disabled={isProcessing}
                    onClick={() => onResolve('merge')}
                  />
                )}
                <ResolutionButton
                  icon={Check}
                  label={`Keep "${stripHtml(conflict.memoryA.title).slice(0, 20)}..."`}
                  variant="success"
                  disabled={isProcessing}
                  onClick={() => onResolve('keep_a')}
                />
                <ResolutionButton
                  icon={Check}
                  label={`Keep "${stripHtml(conflict.memoryB.title).slice(0, 20)}..."`}
                  variant="success"
                  disabled={isProcessing}
                  onClick={() => onResolve('keep_b')}
                />
                <ResolutionButton
                  icon={X}
                  label="Dismiss"
                  variant="muted"
                  disabled={isProcessing}
                  onClick={() => onResolve('dismiss')}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory preview card
// ---------------------------------------------------------------------------

function MemoryPreview({
  label,
  memory,
  agentName,
  accent,
}: {
  label: string;
  memory: PersonaMemory;
  agentName: string;
  accent: 'blue' | 'amber';
}) {
  const borderCls = accent === 'blue' ? 'border-blue-500/20' : 'border-amber-500/20';
  const headerCls = accent === 'blue' ? 'text-blue-400/80' : 'text-amber-400/80';

  return (
    <div className={`rounded-lg border ${borderCls} overflow-hidden`}>
      <div className={`px-2.5 py-1.5 text-xs font-medium ${headerCls} bg-secondary/30 border-b ${borderCls} flex items-center justify-between`}>
        <span>{label}</span>
        <span className="flex items-center gap-1 text-muted-foreground/60">
          <Bot className="w-3 h-3" />
          {agentName}
        </span>
      </div>
      <div className="px-2.5 py-2 space-y-1">
        <p className="text-xs font-medium text-foreground/80 line-clamp-2">{stripHtml(memory.title)}</p>
        <p className="text-xs text-muted-foreground/60 line-clamp-3 whitespace-pre-wrap">{stripHtml(memory.content)}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50 pt-0.5">
          <span className="px-1.5 py-0.5 rounded bg-secondary/40 border border-primary/10 text-xs">{memory.category}</span>
          <span>{new Date(memory.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolution button
// ---------------------------------------------------------------------------

const VARIANT_STYLES = {
  primary: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25 hover:bg-indigo-500/25',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25',
  muted: 'bg-secondary/40 text-muted-foreground/80 border-primary/15 hover:bg-secondary/60',
} as const;

function ResolutionButton({
  icon: Icon,
  label,
  variant,
  disabled,
  onClick,
}: {
  icon: typeof Check;
  label: string;
  variant: keyof typeof VARIANT_STYLES;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 cursor-pointer ${VARIANT_STYLES[variant]}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

function mergeMemories(a: PersonaMemory, b: PersonaMemory): {
  persona_id: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  tags: string[];
} {
  // Keep higher importance, merge content, combine tags
  const tagsA: string[] = a.tags ? (() => { try { return JSON.parse(a.tags); } catch { return []; } })() : [];
  const tagsB: string[] = b.tags ? (() => { try { return JSON.parse(b.tags); } catch { return []; } })() : [];
  const mergedTags = [...new Set([...tagsA, ...tagsB])];

  // Use the newer memory's persona as the owner
  const newer = new Date(a.created_at) > new Date(b.created_at) ? a : b;

  // Combine content
  const contentA = stripHtml(a.content).trim();
  const contentB = stripHtml(b.content).trim();
  const mergedContent = contentA === contentB
    ? contentA
    : `${contentA}\n\n---\n\n${contentB}`;

  return {
    persona_id: newer.persona_id,
    title: stripHtml(newer.title),
    content: mergedContent,
    category: newer.category,
    importance: Math.max(a.importance, b.importance),
    tags: mergedTags,
  };
}
