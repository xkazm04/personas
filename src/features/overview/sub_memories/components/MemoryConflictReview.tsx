import { useState, useMemo, useCallback } from 'react';
import { Shield, ChevronDown, Check } from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { useToastStore } from '@/stores/toastStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  detectConflicts,
  loadResolvedConflicts,
  saveResolvedConflicts,
  type MemoryConflict,
  type ConflictResolution,
} from '../libs/memoryConflicts';
import { mergeMemories } from '../libs/conflictHelpers';
import ConflictCard from './ConflictCard';
import { DebtText } from '@/i18n/DebtText';


interface MemoryConflictReviewProps {
  onConflictsResolved?: () => void;
}

export function MemoryConflictReview({ onConflictsResolved }: MemoryConflictReviewProps) {
  const {
    memories, setMemoryTier, mergeMemories: mergeMemoriesAction, fetchMemories,
  } = useOverviewStore(useShallow((s) => ({
    memories: s.memories,
    setMemoryTier: s.setMemoryTier,
    mergeMemories: s.mergeMemories,
    fetchMemories: s.fetchMemories,
  })));
  const personas = useAgentStore((s) => s.personas);

  const [expanded, setExpanded] = useState(false);
  // Seeded from the persisted verdict set, not `new Set()`. This component IS
  // the Conflicts tab's body and unmounts on every switch back to Memories, so
  // component state meant a user's decisions survived exactly until they looked
  // at something else — and the pairs they had DISMISSED (the detector's own
  // false positives) were the ones guaranteed to come back. Lazy initialiser so
  // the read happens once per mount, not once per render.
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(loadResolvedConflicts);
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
        case 'keep_b': {
          // Resolve to explicit keep/delete memories and ASSERT they differ, so
          // any future reorder of memoryA/memoryB (the `superseded` kind already
          // swaps them) can never silently hard-delete the one the user chose to
          // keep. Refuse to delete a core (user-pinned identity) memory — the
          // same protection archive_by_ids/delete_all enforce, which the raw
          // deleteMemory path lacks.
          const keep = resolution === 'keep_a' ? conflict.memoryA : conflict.memoryB;
          const retire = resolution === 'keep_a' ? conflict.memoryB : conflict.memoryA;
          if (keep.id === retire.id) {
            throw new Error('conflict resolution would retire the kept memory');
          }
          if (retire.tier === 'core') {
            useToastStore.getState().addToast(
              'Cannot retire a core (pinned) memory — resolve this conflict manually',
              'error',
            );
            return;
          }
          // RETIRE, DON'T DELETE. This was `deleteMemory(retire.id)` — an
          // irreversible hard delete of a memory the user merely judged the
          // weaker of two, on the output of a HEURISTIC detector (see
          // memoryConflicts.ts; the thresholds it fires on are documented as
          // "chosen empirically"). A wrong call was unrecoverable and left no
          // trace that the losing claim had ever existed, so nobody could
          // later ask why this memory won.
          //
          // `archive` is the schema's own non-destructive retire — documented
          // on PersonaMemory.tier as "never injected, searchable only" — and
          // it is exactly the door MemoryClaimsSection's `deprecate` already
          // uses for the same judgement. The observable outcome here is
          // unchanged: the list is fetched with the store's default `!archive`
          // filter, so the retired memory leaves this surface and stops being
          // injected, but it is still there to restore or audit.
          await setMemoryTier(retire.id, 'archive');
          break;
        }
        case 'merge': {
          // A merge hard-deletes BOTH originals, so mirror the keep_a/keep_b
          // core guard: refuse if either side is a core (user-pinned) memory.
          // Also refuse a cross-persona merge, which would silently delete one
          // agent's memory and reassign it to the other. The backend rejects
          // both — this just surfaces a clear message instead of a generic
          // failure.
          if (conflict.memoryA.tier === 'core' || conflict.memoryB.tier === 'core') {
            useToastStore.getState().addToast(
              'Cannot merge a core (pinned) memory — resolve this conflict manually',
              'error',
            );
            return;
          }
          if (conflict.memoryA.persona_id !== conflict.memoryB.persona_id) {
            useToastStore.getState().addToast(
              'Cannot merge memories from different agents — resolve this conflict manually',
              'error',
            );
            return;
          }
          const merged = mergeMemories(conflict.memoryA, conflict.memoryB);
          const ok = await mergeMemoriesAction(merged, conflict.memoryA.id, conflict.memoryB.id);
          if (!ok) throw new Error('merge failed');
          break;
        }
        case 'dismiss':
          break;
      }
      // Computed outside the state updater on purpose: an updater must stay
      // pure (StrictMode double-invokes it), so the write to storage happens
      // here rather than inside it.
      const nextResolved = new Set(resolvedIds).add(conflict.id);
      setResolvedIds(nextResolved);
      saveResolvedConflicts(nextResolved);
      if (activeConflictId === conflict.id) setActiveConflictId(null);
      if (resolution !== 'dismiss') await fetchMemories();
      useToastStore.getState().addToast(
        resolution === 'dismiss' ? 'Conflict dismissed' : 'Conflict resolved',
        'success',
      );
      onConflictsResolved?.();
    } catch (err) {
      // The toast alone told the user something failed and told US nothing: the
      // error object was discarded, so a conflict resolution that always fails
      // (a merge the backend rejects, a delete on a row someone else removed)
      // produced no Sentry event and no console trace anywhere. Route it, then
      // keep the toast — this is a user-facing failure AND a background one.
      silentCatch('MemoryConflictReview:handleResolve')(err);
      useToastStore.getState().addToast('Failed to resolve conflict', 'error');
    } finally {
      setProcessing(null);
    }
  }, [setMemoryTier, mergeMemoriesAction, fetchMemories, activeConflictId, onConflictsResolved, resolvedIds]);

  // Rendering `null` here was invisible-by-design in the old banner position,
  // but this component IS the Conflicts tab's entire body: a store with no
  // detected conflicts painted a blank panel, which is indistinguishable from
  // a tab that failed to load. Say the good news instead.
  if (conflicts.length === 0) {
    return (
      <div className="mx-4 md:mx-6 text-center py-6 typo-body text-foreground">
        <Check className="w-5 h-5 mx-auto mb-2 text-emerald-400" />
        <DebtText k="auto_all_conflicts_resolved_b848395b" />
      </div>
    );
  }

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
        <ChevronDown className={`w-3.5 h-3.5 text-foreground flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
          <div className="animate-fade-slide-in overflow-hidden">
            <div className="mt-2 space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {unresolvedConflicts.length === 0 ? (
                <div className="text-center py-6 typo-body text-foreground">
                  <Check className="w-5 h-5 mx-auto mb-2 text-emerald-400" />
                  <DebtText k="auto_all_conflicts_resolved_b848395b" />
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
