import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { PersonaMemory } from "@/lib/types/types";
import type { MemoryStats, MemoryReviewResult, MemoryTier } from "@/api/overview/memories";
import type { MemoryAction } from "@/features/overview/sub_memories/libs/memoryActions";
import { extractActionsFromReview, loadActions, saveActions } from "@/features/overview/sub_memories/libs/memoryActions";
import { createMemory, deleteMemory, listMemoriesWithStats, reviewMemoriesWithCli, updateMemoryTier } from "@/api/overview/memories";


export interface MemorySlice {
  // State
  memories: PersonaMemory[];
  memoriesTotal: number;
  memoryStats: MemoryStats | null;
  memoryActions: MemoryAction[];

  // Actions
  fetchMemories: (filters?: { persona_id?: string; category?: string; search?: string; sort_column?: string; sort_direction?: string }) => Promise<void>;
  createMemory: (input: { persona_id: string; title: string; content: string; category: string; importance: number; tags: string[] }) => Promise<boolean>;
  deleteMemory: (id: string) => Promise<void>;
  reviewMemories: (personaId?: string) => Promise<MemoryReviewResult>;
  setMemoryTier: (id: string, tier: MemoryTier) => Promise<void>;
  dismissMemoryAction: (actionId: string) => void;
  loadMemoryActions: () => void;
}

/** Incrementally update stats after adding a memory. */
function statsAfterCreate(prev: MemoryStats | null, memory: PersonaMemory): MemoryStats {
  if (!prev) return { total: 1, avg_importance: memory.importance, category_counts: [[memory.category, 1]], agent_counts: [[memory.persona_id, 1]] };
  const newTotal = prev.total + 1;
  return {
    total: newTotal,
    avg_importance: (prev.avg_importance * prev.total + memory.importance) / newTotal,
    category_counts: incrementCountEntry(prev.category_counts, memory.category),
    agent_counts: incrementCountEntry(prev.agent_counts, memory.persona_id),
  };
}

/** Incrementally update stats after removing a memory. */
function statsAfterDelete(prev: MemoryStats | null, memory: PersonaMemory): MemoryStats | null {
  if (!prev) return null;
  const newTotal = Math.max(0, prev.total - 1);
  return {
    total: newTotal,
    avg_importance: newTotal > 0 ? (prev.avg_importance * prev.total - memory.importance) / newTotal : 0,
    category_counts: decrementCountEntry(prev.category_counts, memory.category),
    agent_counts: decrementCountEntry(prev.agent_counts, memory.persona_id),
  };
}

function incrementCountEntry(entries: Array<[string, number]>, key: string): Array<[string, number]> {
  const idx = entries.findIndex(([k]) => k === key);
  if (idx === -1) return [...entries, [key, 1]];
  return entries.map(([k, v]) => [k, k === key ? v + 1 : v] as [string, number]);
}

function decrementCountEntry(entries: Array<[string, number]>, key: string): Array<[string, number]> {
  return entries.map(([k, v]) => [k, k === key ? v - 1 : v] as [string, number]).filter(([, v]) => v > 0);
}

export const createMemorySlice: StateCreator<OverviewStore, [], [], MemorySlice> = (set, get) => {
  /** Monotonic counter – only the latest fetch writes to state. */
  let fetchRequestId = 0;

  return {
  memories: [],
  memoriesTotal: 0,
  memoryStats: null,
  memoryActions: loadActions(),

  fetchMemories: async (filters?) => {
    const requestId = ++fetchRequestId;
    try {
      const hasSearch = !!filters?.search?.trim();
      const limit = hasSearch ? 500 : 100;
      const result = await listMemoriesWithStats(
        filters?.persona_id,
        filters?.category,
        filters?.search,
        limit,
        0,
        filters?.sort_column,
        filters?.sort_direction,
      );
      // Discard stale responses — a newer fetch is already in-flight.
      if (requestId !== fetchRequestId) return;
      set({ memories: result.memories, memoriesTotal: result.total, memoryStats: result.stats });
    } catch (err) {
      if (requestId !== fetchRequestId) return;
      reportError(err, "Failed to fetch memories", set);
    }
  },

  createMemory: async (input) => {
    try {
      const created = await createMemory({
        persona_id: input.persona_id,
        title: input.title,
        content: input.content,
        category: input.category,
        importance: input.importance,
        tags: input.tags,
        source_execution_id: null,
      });
      set((state) => ({
        memories: [created, ...state.memories],
        memoriesTotal: state.memoriesTotal + 1,
        memoryStats: statsAfterCreate(state.memoryStats, created),
      }));
      return true;
    } catch (err) {
      reportError(err, "Failed to create memory", set);
      return false;
    }
  },

  deleteMemory: async (id) => {
    try {
      await deleteMemory(id);
      set((state) => {
        const deleted = state.memories.find((m) => m.id === id);
        return {
          memories: state.memories.filter((m) => m.id !== id),
          memoriesTotal: Math.max(0, state.memoriesTotal - 1),
          memoryStats: deleted ? statsAfterDelete(state.memoryStats, deleted) : state.memoryStats,
        };
      });
    } catch (err) {
      reportError(err, "Failed to delete memory", set);
    }
  },

  reviewMemories: async (personaId?) => {
    try {
      const memoriesBefore = get().memories;
      const result = await reviewMemoriesWithCli(personaId);
      // Refresh memories list after review
      await get().fetchMemories();

      // Extract actionable rules from high-scoring memories (8+)
      if (result.details.length > 0) {
        const newActions = extractActionsFromReview(result.details, memoriesBefore);
        if (newActions.length > 0) {
          const all = [...get().memoryActions, ...newActions];
          saveActions(all);
          set({ memoryActions: all });
        }
      }

      return result;
    } catch (err) {
      reportError(err, "Failed to review memories", set);
      throw err;
    }
  },

  setMemoryTier: async (id, tier) => {
    try {
      await updateMemoryTier(id, tier);
      set((state) => ({
        memories: state.memories.map((m) =>
          m.id === id ? { ...m, tier } : m,
        ),
      }));
    } catch (err) {
      reportError(err, "Failed to update memory tier", set);
    }
  },

  dismissMemoryAction: (actionId) => {
    const updated = get().memoryActions.map((a) =>
      a.id === actionId ? { ...a, dismissed: true } : a,
    );
    saveActions(updated);
    set({ memoryActions: updated });
  },

  loadMemoryActions: () => {
    set({ memoryActions: loadActions() });
  },
}; };
