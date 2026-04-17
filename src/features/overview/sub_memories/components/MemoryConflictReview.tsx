import { useState, useMemo, useCallback } from 'react';
import { Shield, ChevronDown, Check } from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';
import { detectConflicts, type MemoryConflict, type ConflictResolution } from '../libs/memoryConflicts';
import { mergeMemories } from '../libs/conflictHelpers';
import ConflictCard from './ConflictCard';

interface MemoryConflictReviewProps {
  onConflictsResolved?: () => void;
}

export function MemoryConflictReview({ onConflictsResolved }: MemoryConflictReviewProps) {
  const {
    memories, deleteMemory, createMemory, fetchMemories,
  } = useOverviewStore(useShallow((s) => ({
    memories: s.memories,
    deleteMemory: s.deleteMemory,
    createMemory: s.createMemory,
    fetchMemories: s.fetchMemories,
  })));
  const personas = useAgentStore((s) => s.personas);

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
          const merged = mergeMemories(conflict.memoryA, conflict.memoryB);
          const created = await createMemory(merged);
          if (created) {
            await deleteMemory(conflict.memoryA.id);
            await deleteMemory(conflict.memoryB.id);
          }
          break;
        }
        case 'dismiss':
          break;
      }
      setResolvedIds((prev) => new Set(prev).add(conflict.id));
      if (activeConflictId === conflict.id) setActiveConflictId(null);
      if (resolution !== 'dismiss') await fetchMemories();
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
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className={`w-full flex items-center gap-2.5 px-4 py-2.5 rounded-modal border transition-all text-left cursor-pointer ${
          expanded ? 'bg-amber-500/8 border-amber-500/25' : 'bg-amber-500/5 border-amber-500/15 hover:border-amber-500/25 hover:bg-amber-500/10'
        }`}
      >
        <Shield className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="typo-heading text-foreground/85 flex-1">
          {unresolvedConflicts.length} conflict{unresolvedConflicts.length !== 1 ? 's' : ''} detected
        </span>
        <div className="flex items-center gap-1.5">
          {countByKind.contradiction > 0 && (
            <span className="px-1.5 py-0.5 typo-caption rounded-card bg-red-500/15 text-red-400 border border-red-500/20">
              {countByKind.contradiction} contradiction{countByKind.contradiction !== 1 ? 's' : ''}
            </span>
          )}
          {countByKind.duplicate > 0 && (
            <span className="px-1.5 py-0.5 typo-caption rounded-card bg-amber-500/15 text-amber-400 border border-amber-500/20">
              {countByKind.duplicate} duplicate{countByKind.duplicate !== 1 ? 's' : ''}
            </span>
          )}
          {countByKind.superseded > 0 && (
            <span className="px-1.5 py-0.5 typo-caption rounded-card bg-blue-500/15 text-blue-400 border border-blue-500/20">
              {countByKind.superseded} superseded
            </span>
          )}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
          <div className="animate-fade-slide-in overflow-hidden">
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
          </div>
        )}
    </div>
  );
}
